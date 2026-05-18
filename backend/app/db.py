"""SQLite access layer — the ONLY module that opens the database.

Phase 2 teaching points are in the comments: why WAL, why foreign_keys must
be set per-connection, and why the schema is one idempotent migration.
"""
import json
import os
import sqlite3
from contextlib import contextmanager

# The path is /data/signaldesk.db inside the container, which is bind-mounted
# to ./data on your Mac (see docker-compose.yml) so a GUI can open it.
DB_PATH = os.environ.get("DB_PATH", "/data/signaldesk.db")

# The full schema from ARCHITECTURE.md §4. Created once; safe to re-run because
# every statement uses IF NOT EXISTS — that's what "idempotent migration"
# means: running it again changes nothing.
SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY,
  symbol      TEXT UNIQUE NOT NULL,
  yf_ticker   TEXT,
  asset_class TEXT NOT NULL,
  aliases     TEXT,                                  -- JSON array as text
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS prices (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  ts       TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  PRIMARY KEY (asset_id, ts)
);

CREATE TABLE IF NOT EXISTS signals (
  asset_id    INTEGER NOT NULL REFERENCES assets(id),
  computed_at TEXT NOT NULL,
  trend TEXT, pct_change REAL, volume_flag TEXT, vix_regime TEXT,
  payload TEXT,
  PRIMARY KEY (asset_id, computed_at)
);

CREATE TABLE IF NOT EXISTS briefings (
  id         INTEGER PRIMARY KEY,
  date       TEXT UNIQUE NOT NULL,
  body       TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id          INTEGER PRIMARY KEY,
  briefing_id INTEGER NOT NULL REFERENCES briefings(id),
  body        TEXT NOT NULL,
  provenance  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_analysis (
  id         INTEGER PRIMARY KEY,
  asset_id   INTEGER NOT NULL REFERENCES assets(id),
  date       TEXT NOT NULL,
  body       TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER REFERENCES assets(id),
  kind TEXT, body TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER REFERENCES assets(id),
  title TEXT, body TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS macro (
  id INTEGER PRIMARY KEY,
  series TEXT, value REAL, observed_at TEXT, fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY,
  title TEXT, url TEXT, source TEXT, saved_at TEXT NOT NULL
);

-- Tracks WHEN we last hit the network per asset (not the data's own date).
-- This is what makes the read-through cache actually cache.
CREATE TABLE IF NOT EXISTS price_fetch (
  asset_id   INTEGER PRIMARY KEY REFERENCES assets(id),
  fetched_at TEXT NOT NULL
);
"""

# Your initial watchlist, expressed as DATA (the scalability backbone).
# (symbol, yf_ticker, asset_class, aliases)
SEED_ASSETS = [
    ("SPY", "SPY", "equity", []),
    ("AAPL", "AAPL", "equity", []),
    ("INTC", "INTC", "equity", []),
    ("NVDA", "NVDA", "equity", []),
    ("TSLA", "TSLA", "equity", []),
    ("BTC-USD", "BTC-USD", "crypto", []),
    ("VIX", "^VIX", "index", []),          # display "VIX", yfinance wants ^VIX
    ("ETH-USD", "ETH-USD", "crypto", []),
    ("SOL-USD", "SOL-USD", "crypto", []),
    ("PFE", "PFE", "equity", ["PFIZER"]),  # alias so the AI can resolve names
]


@contextmanager
def get_conn():
    """Yield a SQLite connection with our invariants applied.

    Two SQLite gotchas handled here:
    • `foreign_keys` is OFF by default AND is a *per-connection* setting — it
      must be turned on for every connection, not once globally.
    • `row_factory = sqlite3.Row` makes rows behave like dicts (row["symbol"])
      instead of opaque tuples — much clearer code.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create the file + schema, set WAL, and seed the watchlist if empty.

    Called once on backend startup. Idempotent: safe on every boot.
    """
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        # WAL is written into the DB file itself, so it only needs setting
        # once, but re-setting is harmless. It lets the dashboard keep reading
        # while the cron writes — no "database is locked" stalls.
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.executescript(SCHEMA)

        count = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        if count == 0:
            conn.executemany(
                "INSERT INTO assets (symbol, yf_ticker, asset_class, aliases) "
                "VALUES (?, ?, ?, ?)",
                [
                    (sym, yf, cls, json.dumps(aliases))
                    for sym, yf, cls, aliases in SEED_ASSETS
                ],
            )


def get_asset_by_symbol(symbol: str) -> dict | None:
    """Resolve a symbol OR one of its aliases (case-insensitive).

    This is why the registry stores aliases: typing "PFIZER" must find PFE.
    SQLite has no native JSON-array search, so we filter aliases in Python —
    fine at this scale (10s of assets), and obvious to read.
    """
    s = symbol.strip().upper()
    for a in list_assets(enabled_only=False):
        if a["symbol"].upper() == s or s in [x.upper() for x in a["aliases"]]:
            return a
    return None


def read_prices(asset_id: int, days: int) -> list[dict]:
    """Return the most recent `days` cached candles, oldest first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT ts, open, high, low, close, volume FROM prices "
            "WHERE asset_id = ? ORDER BY ts DESC LIMIT ?",
            (asset_id, days),
        ).fetchall()
    rows = list(reversed(rows))  # DESC+LIMIT got the newest; flip to oldest-first
    return [
        {
            "time": r["ts"],
            "open": r["open"],
            "high": r["high"],
            "low": r["low"],
            "close": r["close"],
            "volume": r["volume"],
        }
        for r in rows
    ]


def upsert_prices(asset_id: int, candles: list[dict]) -> None:
    """Insert/replace candles. The composite PK (asset_id, ts) makes this a
    natural de-dupe: re-fetching the same day just overwrites the row instead
    of creating a duplicate — the SCHEMA enforces it, not our code."""
    with get_conn() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO prices "
            "(asset_id, ts, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    asset_id,
                    c["time"],
                    c["open"],
                    c["high"],
                    c["low"],
                    c["close"],
                    c["volume"],
                )
                for c in candles
            ],
        )


def get_briefing(date: str) -> dict | None:
    import json

    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, date, body, provenance, created_at FROM briefings "
            "WHERE date = ?",
            (date,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "date": row["date"],
        "body": row["body"],
        "provenance": json.loads(row["provenance"]),
        "created_at": row["created_at"],
    }


def list_briefings() -> list[dict]:
    """Lightweight list for the date browser, newest first."""
    import json

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT date, provenance, created_at FROM briefings "
            "ORDER BY date DESC"
        ).fetchall()
    out = []
    for r in rows:
        p = json.loads(r["provenance"])
        out.append(
            {
                "date": r["date"],
                "provider": p.get("provider", "?"),
                "model": p.get("model", "?"),
                "risk_stance": p.get("risk_stance"),
                "created_at": r["created_at"],
            }
        )
    return out


def get_annotations(briefing_id: int) -> list[dict]:
    """Tier-2 layers for a briefing, oldest first (reading order)."""
    import json

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, briefing_id, body, provenance, created_at "
            "FROM annotations WHERE briefing_id=? ORDER BY id ASC",
            (briefing_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "briefing_id": r["briefing_id"],
            "body": r["body"],
            "provenance": json.loads(r["provenance"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def add_annotation(briefing_id: int, body: str, provenance: dict) -> dict:
    """Append a Tier-2 annotation. NEVER updates the briefing row — this is
    the structural guarantee that the original draft survives forever."""
    import json
    from datetime import datetime, timezone

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO annotations "
            "(briefing_id, body, provenance, created_at) VALUES (?, ?, ?, ?)",
            (
                briefing_id,
                body,
                json.dumps(provenance),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        new_id = cur.lastrowid
    return {
        "id": new_id,
        "briefing_id": briefing_id,
        "body": body,
        "provenance": provenance,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def get_latest_briefing() -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT date FROM briefings ORDER BY date DESC LIMIT 1"
        ).fetchone()
    return get_briefing(row["date"]) if row else None


def upsert_briefing(date: str, body: str, provenance: dict) -> None:
    """One row per date (date is UNIQUE). Re-running the same day REPLACES the
    digest — idempotent, so the cron firing twice is harmless. NOTE: this is
    the Tier-1 draft; Tier-2 corrections go into the separate `annotations`
    table, never an UPDATE here (the git-like audit rule from §4)."""
    import json
    from datetime import datetime, timezone

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO briefings (date, body, provenance, created_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET "
            "  body=excluded.body, provenance=excluded.provenance, "
            "  created_at=excluded.created_at",
            (
                date,
                body,
                json.dumps(provenance),
                datetime.now(timezone.utc).isoformat(),
            ),
        )


def get_asset_analysis_by_symbol(symbol: str) -> list[dict]:
    """All notes (Tier-1 auto + Tier-2 deep-dives) for an asset, newest
    first. Tier shows in provenance — the UI/agent can tell them apart."""
    import json

    a = get_asset_by_symbol(symbol)
    if a is None:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, date, body, provenance, created_at FROM "
            "asset_analysis WHERE asset_id=? ORDER BY date DESC, id DESC",
            (a["id"],),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "symbol": a["symbol"],
            "date": r["date"],
            "body": r["body"],
            "provenance": json.loads(r["provenance"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def add_asset_analysis(
    symbol: str, body: str, provenance: dict
) -> dict | None:
    """Append a Tier-2 deep-dive. APPEND-only: does NOT delete the Tier-1
    auto-note (that's `replace_tier1_asset_note`'s job). Both coexist; the
    audit trail keeps growing — same git-like rule as annotations."""
    import json
    from datetime import datetime, timezone

    a = get_asset_by_symbol(symbol)
    if a is None:
        return None
    today = datetime.now(timezone.utc).date().isoformat()
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO asset_analysis "
            "(asset_id, date, body, provenance, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (a["id"], today, body, json.dumps(provenance), now),
        )
        nid = cur.lastrowid
    return {
        "id": nid,
        "symbol": a["symbol"],
        "date": today,
        "body": body,
        "provenance": provenance,
        "created_at": now,
    }


def replace_tier1_asset_note(
    asset_id: int, date: str, body: str, provenance: dict
) -> None:
    """Per-asset Tier-1 auto-note. Idempotent per (asset, date): delete the
    prior tier-1 note for that day, then insert. Tier-2 deep-dives are
    separate rows (different provenance) and are NOT touched here."""
    import json
    from datetime import datetime, timezone

    with get_conn() as conn:
        conn.execute(
            "DELETE FROM asset_analysis WHERE asset_id=? AND date=? "
            "AND json_extract(provenance,'$.tier')=1",
            (asset_id, date),
        )
        conn.execute(
            "INSERT INTO asset_analysis "
            "(asset_id, date, body, provenance, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                asset_id,
                date,
                body,
                json.dumps(provenance),
                datetime.now(timezone.utc).isoformat(),
            ),
        )


def upsert_signal(asset_id: int, computed_at: str, summary: dict) -> None:
    """Persist one day's Tier 0 summary. computed_at is a DATE string so
    there's one row per asset per day; INSERT OR REPLACE (with the composite
    PK) makes recomputing the same day idempotent. Phase 6's briefing reads
    these rows; that's why Tier 0 writes them, not just returns them."""
    import json

    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO signals "
            "(asset_id, computed_at, trend, pct_change, volume_flag, "
            " vix_regime, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                asset_id,
                computed_at,
                summary.get("trend"),
                summary.get("pct_change"),
                summary.get("volume_flag"),
                summary.get("vix_regime"),
                json.dumps(summary),
            ),
        )


def get_latest_signal(asset_id: int) -> dict | None:
    import json

    with get_conn() as conn:
        row = conn.execute(
            "SELECT computed_at, payload FROM signals WHERE asset_id = ? "
            "ORDER BY computed_at DESC LIMIT 1",
            (asset_id,),
        ).fetchone()
    if not row:
        return None
    data = json.loads(row["payload"])
    data["computed_at"] = row["computed_at"]
    return data


def get_previous_signal(asset_id: int, before_date: str) -> dict | None:
    """The most recent persisted signal STRICTLY before `before_date`.
    Powers day-over-day deltas — and because we persist one row per day,
    'what changed since yesterday' is just a lookup + diff, no extra storage."""
    import json

    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM signals WHERE asset_id=? AND computed_at<? "
            "ORDER BY computed_at DESC LIMIT 1",
            (asset_id, before_date),
        ).fetchone()
    return json.loads(row["payload"]) if row else None


def get_last_fetch(asset_id: int) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT fetched_at FROM price_fetch WHERE asset_id = ?",
            (asset_id,),
        ).fetchone()
    return row["fetched_at"] if row else None


def set_last_fetch(asset_id: int, iso_ts: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO price_fetch (asset_id, fetched_at) "
            "VALUES (?, ?)",
            (asset_id, iso_ts),
        )


def list_assets(enabled_only: bool = True) -> list[dict]:
    """Read the asset registry. Returns plain dicts with aliases parsed."""
    sql = "SELECT id, symbol, yf_ticker, asset_class, aliases, enabled FROM assets"
    if enabled_only:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY id"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return [
        {
            "id": r["id"],
            "symbol": r["symbol"],
            "yf_ticker": r["yf_ticker"],
            "asset_class": r["asset_class"],
            "aliases": json.loads(r["aliases"]) if r["aliases"] else [],
            "enabled": bool(r["enabled"]),
        }
        for r in rows
    ]
