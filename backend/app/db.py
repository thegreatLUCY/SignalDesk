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
    # WAL already lets many readers run with one writer. busy_timeout makes a
    # second writer WAIT (up to 5s) for the lock instead of instantly raising
    # "database is locked" — needed now that /signals fetches assets in
    # parallel (Phase 10 perf pass). Per-connection, like foreign_keys.
    conn.execute("PRAGMA busy_timeout = 5000;")
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
        _migrate(conn)

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


# Additive, idempotent schema migrations.
#
# THE LESSON: `CREATE TABLE IF NOT EXISTS` only ever runs once — on a DB
# where the table already exists it is a silent no-op, so editing the SCHEMA
# string does NOT change a live table. A schema is the shape for a *fresh*
# DB; evolving an *existing* DB needs an explicit migration. SQLite's
# `ALTER TABLE ADD COLUMN` is metadata-only (O(1), no row rewrite) and
# non-destructive, so the safe pattern for a single-user local DB is:
# "for every column we now expect, add it if the live table lacks it."
# Each entry is (table, column, column-definition).
_MIGRATIONS: list[tuple[str, str, str]] = [
    # Phase 9 — promote the placeholder `journal` into a real trade log.
    ("journal", "symbol", "symbol TEXT"),
    ("journal", "side", "side TEXT"),                 # long | short | NULL
    ("journal", "entry", "entry REAL"),
    ("journal", "exit", '"exit" REAL'),               # exit is a SQL keyword
    ("journal", "size", "size REAL"),
    ("journal", "status", "status TEXT DEFAULT 'open'"),
    ("journal", "thesis", "thesis TEXT"),             # why I entered
    ("journal", "outcome", "outcome TEXT"),           # the lesson, on close
    ("journal", "opened_at", "opened_at TEXT"),
    ("journal", "closed_at", "closed_at TEXT"),
    ("journal", "updated_at", "updated_at TEXT"),
    # Phase 9 — notes gain creation time + pinning.
    ("notes", "created_at", "created_at TEXT"),
    ("notes", "pinned", "pinned INTEGER DEFAULT 0"),
]


def _migrate(conn) -> None:
    """Bring every table up to the columns this code version expects.

    Idempotent: `PRAGMA table_info` lists the columns that actually exist on
    the live table, so we only ALTER what's missing — running this on every
    boot (fresh DB or year-old DB) converges to the same shape and is a
    no-op once applied."""
    for table, column, ddl in _MIGRATIONS:
        cols = {
            r["name"]
            for r in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


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


# NOTE: the per-asset `asset_analysis` access layer was removed. Tier-2 now
# lives ONLY as consolidated annotations on the daily briefing (see
# add_annotation / get_annotations above). The `asset_analysis` table is
# left in SCHEMA but unused — dropping it would need a destructive migration
# for zero benefit on a single-user local DB; any old rows are simply inert.


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


# ── Phase 9: trading journal ────────────────────────────────────────────────
#
# A learning journal, not a broker ledger. The user records WHY (thesis) and
# later WHAT THEY LEARNED (outcome); the money math is never typed — P/L is
# DERIVED from entry/exit/size/side. Same principle as the deterministic risk
# call: a conclusion the user cannot accidentally contradict ("no garbage in").

def _pl(side, entry, exit_, size):
    """Deterministic P/L. Returns (abs, pct) or (None, None) when it can't be
    computed yet (still open / missing a leg). Short = profit when price falls,
    so the sign flips. We never guess — incomplete data yields None, exactly
    like Tier 0."""
    if entry is None or exit_ is None or not entry:
        return None, None
    direction = -1.0 if side == "short" else 1.0
    pct = (exit_ / entry - 1.0) * 100.0 * direction
    abs_ = ((exit_ - entry) * size * direction) if size else None
    return abs_, pct


def _journal_row(r: dict) -> dict:
    pl_abs, pl_pct = _pl(r["side"], r["entry"], r["exit"], r["size"])
    return {
        "id": r["id"],
        "kind": r["kind"],
        "symbol": r["symbol"],
        "side": r["side"],
        "entry": r["entry"],
        "exit": r["exit"],
        "size": r["size"],
        "status": r["status"],
        "thesis": r["thesis"],
        "outcome": r["outcome"],
        "opened_at": r["opened_at"],
        "closed_at": r["closed_at"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "pl_abs": pl_abs,
        "pl_pct": pl_pct,
    }


_JOURNAL_COLS = (
    "id, kind, symbol, side, entry, \"exit\", size, status, thesis, "
    "outcome, opened_at, closed_at, created_at, updated_at"
)


def list_journal() -> list[dict]:
    """All journal entries, newest first. Open positions naturally sort to
    the top because they're the most recent / actionable."""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {_JOURNAL_COLS} FROM journal "
            "ORDER BY (status='open') DESC, id DESC"
        ).fetchall()
    return [_journal_row(dict(r)) for r in rows]


def add_journal(data: dict) -> dict:
    """Create an entry. `symbol` is stored as text (a snapshot) so an
    observation on any ticker works even if it's not in the watchlist; we
    still resolve it to asset_id when it matches the registry, keeping the FK
    useful without making it a hard requirement."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    sym = (data.get("symbol") or "").strip().upper() or None
    a = get_asset_by_symbol(sym) if sym else None
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO journal (asset_id, symbol, kind, side, entry, "
            '"exit", size, status, thesis, outcome, opened_at, closed_at, '
            "created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                a["id"] if a else None,
                sym,
                data.get("kind", "observation"),
                data.get("side"),
                data.get("entry"),
                data.get("exit"),
                data.get("size"),
                data.get("status") or "open",
                data.get("thesis"),
                data.get("outcome"),
                data.get("opened_at") or now[:10],
                data.get("closed_at"),
                now,
                now,
            ),
        )
        nid = cur.lastrowid
        row = conn.execute(
            f"SELECT {_JOURNAL_COLS} FROM journal WHERE id=?", (nid,)
        ).fetchone()
    return _journal_row(dict(row))


# Only these fields are user-editable; everything else (ids, created_at,
# computed P/L) is owned by the system. A whitelist, not a blanket UPDATE,
# is the safe shape for a PATCH endpoint.
_JOURNAL_EDITABLE = {
    "kind", "symbol", "side", "entry", "exit", "size",
    "status", "thesis", "outcome", "opened_at", "closed_at",
}


def update_journal(entry_id: int, patch: dict) -> dict | None:
    """Partial update (PATCH semantics): only keys present in `patch` and on
    the whitelist are written. Closing a trade = setting status='closed'
    (+ exit/outcome); we stamp closed_at automatically so the timeline is
    honest even if the user forgets."""
    from datetime import datetime, timezone

    fields = {k: v for k, v in patch.items() if k in _JOURNAL_EDITABLE}
    if not fields:
        return get_journal(entry_id)
    if fields.get("status") == "closed" and not fields.get("closed_at"):
        fields["closed_at"] = datetime.now(timezone.utc).isoformat()[:10]
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    # quote `exit` (reserved word) only where it appears as a column name
    sets = ", ".join(
        f'"{k}"=?' if k == "exit" else f"{k}=?" for k in fields
    )
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE journal SET {sets} WHERE id=?",
            (*fields.values(), entry_id),
        )
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            f"SELECT {_JOURNAL_COLS} FROM journal WHERE id=?", (entry_id,)
        ).fetchone()
    return _journal_row(dict(row))


def get_journal(entry_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {_JOURNAL_COLS} FROM journal WHERE id=?", (entry_id,)
        ).fetchone()
    return _journal_row(dict(row)) if row else None


def delete_journal(entry_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM journal WHERE id=?", (entry_id,))
    return cur.rowcount > 0


# ── Phase 9: Notion-like notes ──────────────────────────────────────────────
#
# Free-form markdown. Unlike asset_analysis (append-only audit trail), a note
# is a living document the user OWNS — so here an UPDATE in place is correct.
# Different data, different rule: provenance/audit tables never mutate;
# personal documents do. Knowing which is which is the design judgement.

def _note_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "symbol": r["symbol"],
        "title": r["title"],
        "body": r["body"],
        "pinned": bool(r["pinned"]),
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


def list_notes() -> list[dict]:
    """Pinned first, then most-recently-edited — the order you actually want
    to scan a knowledge base in."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT n.id, a.symbol AS symbol, n.title, n.body, "
            "n.pinned, n.created_at, n.updated_at "
            "FROM notes n LEFT JOIN assets a ON a.id = n.asset_id "
            "ORDER BY n.pinned DESC, n.updated_at DESC"
        ).fetchall()
    return [_note_row(dict(r)) for r in rows]


def _note_by_id(conn, note_id: int):
    return conn.execute(
        "SELECT n.id, a.symbol AS symbol, n.title, n.body, n.pinned, "
        "n.created_at, n.updated_at FROM notes n "
        "LEFT JOIN assets a ON a.id = n.asset_id WHERE n.id=?",
        (note_id,),
    ).fetchone()


def get_note(note_id: int) -> dict | None:
    with get_conn() as conn:
        row = _note_by_id(conn, note_id)
    return _note_row(dict(row)) if row else None


def add_note(title: str, body: str, symbol: str | None) -> dict:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    sym = (symbol or "").strip().upper() or None
    a = get_asset_by_symbol(sym) if sym else None
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO notes (asset_id, title, body, pinned, "
            "created_at, updated_at) VALUES (?,?,?,0,?,?)",
            (a["id"] if a else None, title, body, now, now),
        )
        row = _note_by_id(conn, cur.lastrowid)
    return _note_row(dict(row))


def update_note(note_id: int, patch: dict) -> dict | None:
    """In-place edit (notes are living docs). asset_id is re-resolved when a
    `symbol` is supplied so a note can be re-targeted to another asset."""
    from datetime import datetime, timezone

    sets, vals = [], []
    if "title" in patch:
        sets.append("title=?"); vals.append(patch["title"])
    if "body" in patch:
        sets.append("body=?"); vals.append(patch["body"])
    if "pinned" in patch:
        sets.append("pinned=?"); vals.append(1 if patch["pinned"] else 0)
    if "symbol" in patch:
        sym = (patch["symbol"] or "").strip().upper() or None
        a = get_asset_by_symbol(sym) if sym else None
        sets.append("asset_id=?"); vals.append(a["id"] if a else None)
    if not sets:
        return get_note(note_id)
    sets.append("updated_at=?")
    vals.append(datetime.now(timezone.utc).isoformat())
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE notes SET {', '.join(sets)} WHERE id=?",
            (*vals, note_id),
        )
        if cur.rowcount == 0:
            return None
        row = _note_by_id(conn, note_id)
    return _note_row(dict(row))


def delete_note(note_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    return cur.rowcount > 0


# ── Phase 10: macro (FRED) + news (RSS) ─────────────────────────────────────
#
# Same read-through-cache discipline as prices: freshness = WHEN WE FETCHED
# (the `fetched_at` column), never the data's own observation date. Macro
# series move slowly, headlines hourly — the route layer sets the TTL.

def replace_macro_series(
    series: str, value: float | None, observed_at: str | None, fetched_at: str
) -> None:
    """One row per FRED series (latest value). Idempotent: delete the prior
    row for this series, insert the fresh one — the macro table has no
    UNIQUE(series), so we enforce 'one row per series' here, the same
    delete-then-insert pattern used elsewhere."""
    with get_conn() as conn:
        conn.execute("DELETE FROM macro WHERE series = ?", (series,))
        conn.execute(
            "INSERT INTO macro (series, value, observed_at, fetched_at) "
            "VALUES (?, ?, ?, ?)",
            (series, value, observed_at, fetched_at),
        )


def get_macro() -> list[dict]:
    """All stored macro series, plus the freshest fetched_at (so the route
    can decide staleness without a second query)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT series, value, observed_at, fetched_at FROM macro"
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_news(items: list[dict]) -> int:
    """Insert headlines, de-duped by URL. `news.url` isn't UNIQUE in the
    schema, so we filter against existing URLs in Python (fine at this
    scale) — re-fetching the same feed never piles up duplicates. Returns
    how many were new."""
    if not items:
        return 0
    with get_conn() as conn:
        have = {
            r["url"]
            for r in conn.execute("SELECT url FROM news").fetchall()
        }
        fresh = [i for i in items if i["url"] not in have]
        conn.executemany(
            "INSERT INTO news (title, url, source, saved_at) "
            "VALUES (?, ?, ?, ?)",
            [(i["title"], i["url"], i["source"], i["saved_at"]) for i in fresh],
        )
    return len(fresh)


def get_news(limit: int = 40) -> list[dict]:
    """Most recently saved headlines first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, url, source, saved_at FROM news "
            "ORDER BY saved_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def latest_news_fetch() -> str | None:
    """saved_at of the newest headline — our 'when did we last pull' clock
    for the news read-through cache (same idea as price_fetch)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT saved_at FROM news ORDER BY saved_at DESC LIMIT 1"
        ).fetchone()
    return row["saved_at"] if row else None
