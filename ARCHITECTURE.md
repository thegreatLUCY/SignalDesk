# SignalDesk Local — Architecture & Phased Build Plan

> Status: **plan for review — no application code written yet.**
> Read this, push back, then we build phase by phase. Every section has a
> **Technical learning** block: not just *why* we chose something, but the
> underlying concept so you understand the machinery, not just the decision.

---

## 0. The one principle everything hangs off

**One source of truth (SQLite). Many writers and readers around it.**

```
                         ┌─────────────────────────────┐
                         │        SQLite (one file)     │
                         │  assets · prices · signals   │
                         │  briefings · annotations     │
                         │  asset_analysis · journal    │
                         │  notes · macro · news        │
                         └──────────────┬──────────────┘
                                        │  (only the backend touches the DB)
                         ┌──────────────┴──────────────┐
                         │      FastAPI backend :8081    │
                         │  data adapters · signal engine│
                         │  REST API · cron entrypoint   │
                         └──┬──────────┬──────────┬──────┘
                            │          │          │
            ┌───────────────┘          │          └────────────────┐
            ▼                          ▼                           ▼
   ┌────────────────┐        ┌──────────────────┐        ┌──────────────────┐
   │ Next.js :3000  │        │ Daily cron 10:30 │        │  MCP server       │
   │ dashboard UI   │        │ ET (free LLM,    │        │ (local, stdio)    │
   │ charts/archive │        │ writes digest +  │        │ Claude/Codex →    │
   │ (reader)       │        │ per-asset notes) │        │ deep analysis     │
   └────────────────┘        └──────────────────┘        └──────────────────┘
       reader                  writer (Tier 1)              writer (Tier 2)
```

**Technical learning — why funnel everything through the backend instead of
letting the UI/MCP/cron each open the SQLite file directly?**
SQLite is a *single-writer* database: it serializes writes with a file lock.
If three processes open the same file and write concurrently you get
`database is locked` errors and corruption risk. By making the FastAPI backend
the *only* process that opens the DB, every write goes through one place that
can enforce ordering, validation, and the provenance rules. The cron job and
MCP server don't touch the file — they call the backend (or import its
service layer in-process). This is the single most important structural
decision in the project.

---

## 1. Component map (what each piece *is*, technically)

| Component | What it technically is | Talks to |
|---|---|---|
| **SQLite DB** | A single `.db` file; an embedded SQL engine linked into the Python process — no server | backend only |
| **FastAPI backend** | A Python ASGI web app (async HTTP server) exposing JSON REST endpoints | DB, data sources, LLM |
| **Data adapters** | Plain Python classes implementing one `DataSource` interface | yfinance, Binance REST |
| **Signal engine** | Pure Python functions: numbers in → labels out, no I/O, no AI | called by backend/cron |
| **Daily cron** | A scheduled process that runs one Python entrypoint at 10:30 ET | backend service layer, free LLM |
| **MCP server** | A local Python process speaking the Model Context Protocol over stdio | Claude/Codex client, backend |
| **Next.js frontend** | A React app + Node dev server; renders the dashboard, calls the REST API | backend (HTTP) |

**Technical learning — "embedded" vs "client/server" databases.**
Postgres/MySQL run as a separate server process you connect to over a socket.
SQLite has no server: the database engine is a library compiled into your
program, and the database is just a file on disk. That's *exactly* why it fits
a local-first single-user tool — zero infrastructure, zero ports, zero
credentials. The tradeoff (single concurrent writer) is the thing section 0
designs around.

---

## 2. Technology choices — the technical "why"

- **FastAPI (ASGI, async).** ASGI = Asynchronous Server Gateway Interface.
  Unlike the older WSGI (one request blocks one worker thread), ASGI lets one
  worker handle many requests cooperatively via `async/await`. Concretely:
  when we call yfinance or an LLM (slow network I/O), an async handler can
  *yield* the CPU so the server stays responsive instead of freezing. FastAPI
  also auto-generates an OpenAPI schema and a `/docs` page — free, interactive
  API documentation, which is great for a learning build.
- **Pydantic models** (ships with FastAPI). Define the *shape* of data once;
  get validation + JSON serialization for free. A `Briefing` model is the same
  contract the DB, the API, and the MCP tools all speak.
- **SQLite + WAL mode.** WAL = Write-Ahead Logging. Default SQLite blocks
  readers while a write happens. WAL lets readers keep reading the last good
  state while a write appends to a separate log — so the dashboard never
  stalls because the cron is writing. One `PRAGMA journal_mode=WAL;` buys this.
- **lightweight-charts.** TradingView's open-source canvas charting lib
  (~45 KB). It is *not* React; it draws to an HTML `<canvas>` imperatively.
  Technical consequence: we wrap it in a React component that creates the
  chart in a `useEffect`, feeds it data, and destroys it on unmount — React
  owns the lifecycle, the library owns the pixels.
- **MCP over stdio.** The Model Context Protocol is a JSON-RPC-style protocol.
  "stdio transport" means the client (Claude Desktop) launches your server as
  a subprocess and talks to it over stdin/stdout pipes — no network port, no
  auth, nothing exposed. That is *why* this is free and safe: it's literally a
  local program the AI app pipes JSON to.
- **Docker Compose.** Declares the services (backend, frontend, cron, mcp) and
  a shared **volume** for the SQLite file so the DB persists across container
  restarts and is the same file every service' backend sees.

---

## 3. Repository structure

```
signaldesk/
├── ARCHITECTURE.md            ← this document
├── README.md                  ← how to run it locally
├── docker-compose.yml         ← defines all services + the DB volume
├── .env.example               ← LLM provider keys/config (gitignored real .env)
│
├── backend/
│   ├── app/
│   │   ├── main.py            ← FastAPI app + route registration
│   │   ├── db.py              ← SQLite connection, WAL pragma, migrations
│   │   ├── models.py          ← Pydantic + table schemas
│   │   ├── datasources/
│   │   │   ├── base.py        ← DataSource interface (the abstraction)
│   │   │   ├── yfinance_src.py← equities/index adapter
│   │   │   └── binance_src.py ← crypto adapter (free REST klines)
│   │   ├── signals.py         ← Tier 0: pure deterministic rules
│   │   ├── llm.py             ← provider chain Groq→OpenRouter→template
│   │   ├── briefing.py        ← Tier 1: build digest + per-asset notes
│   │   ├── routes/            ← REST endpoints (assets, signals, briefings…)
│   │   └── cron_entry.py      ← the 10:30 ET job's single entrypoint
│   └── requirements.txt
│
├── mcp/
│   └── server.py              ← MCP tools wrapping the backend service layer
│
└── frontend/
    ├── app/                   ← Next.js App Router pages
    │   ├── page.tsx           ← dashboard home
    │   ├── asset/[symbol]/    ← asset detail + chart
    │   └── archive/           ← date-browsable briefings (the "Notion feel")
    ├── components/            ← Chart, WatchlistTable, BriefingCard…
    └── lib/api.ts             ← typed fetch wrappers to :8081
```

**Technical learning — why a hard frontend/backend split with its own folders?**
They are different runtimes (Python vs Node), different dependency managers
(pip vs npm), different processes. Keeping them physically separate means each
can be built, run, and reasoned about independently, and the contract between
them is *only* the HTTP API — the cleanest possible seam.

---

## 4. The SQLite schema (with the reasoning per table)

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;       -- SQLite has FKs OFF by default; we want them ON

-- The scalability backbone: assets are DATA, not code.
CREATE TABLE assets (
  id          INTEGER PRIMARY KEY,
  symbol      TEXT UNIQUE NOT NULL,        -- what you see: NVDA, BTC-USD
  yf_ticker   TEXT,                        -- yfinance query symbol: ^VIX
  asset_class TEXT NOT NULL,               -- 'equity' | 'index' | 'crypto'
  aliases     TEXT,                        -- JSON array: ["PFIZER"]
  enabled     INTEGER NOT NULL DEFAULT 1
);

-- Raw OHLC cache so we don't re-hit yfinance/Binance every page load.
CREATE TABLE prices (
  asset_id  INTEGER NOT NULL REFERENCES assets(id),
  ts        TEXT NOT NULL,                 -- ISO date/datetime
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  PRIMARY KEY (asset_id, ts)               -- composite key = natural dedupe
);

-- Tier 0 output, recomputed each run; cheap, deterministic.
CREATE TABLE signals (
  asset_id  INTEGER NOT NULL REFERENCES assets(id),
  computed_at TEXT NOT NULL,
  trend TEXT, pct_change REAL, volume_flag TEXT,
  vix_regime TEXT, payload TEXT,           -- JSON: full signal snapshot
  PRIMARY KEY (asset_id, computed_at)
);

-- Tier 1: ONE row per day. The free-LLM digest.
CREATE TABLE briefings (
  id          INTEGER PRIMARY KEY,
  date        TEXT UNIQUE NOT NULL,        -- 'YYYY-MM-DD' — the fetch key
  body        TEXT NOT NULL,               -- segmented: equities | crypto | macro
  provenance  TEXT NOT NULL,               -- JSON: {tier:1, model, provider, signal_snapshot_id}
  created_at  TEXT NOT NULL
);

-- Tier 2: annotations LAYERED on a briefing — never an UPDATE of `briefings`.
CREATE TABLE annotations (
  id          INTEGER PRIMARY KEY,
  briefing_id INTEGER NOT NULL REFERENCES briefings(id),
  body        TEXT NOT NULL,
  provenance  TEXT NOT NULL,               -- JSON: {tier:2, model:'claude', ...}
  created_at  TEXT NOT NULL
);

-- Tier 1 per-asset notes + Tier 2 deep on-demand analysis share one table,
-- distinguished by provenance tier.
CREATE TABLE asset_analysis (
  id          INTEGER PRIMARY KEY,
  asset_id    INTEGER NOT NULL REFERENCES assets(id),
  date        TEXT NOT NULL,
  body        TEXT NOT NULL,
  provenance  TEXT NOT NULL,               -- {tier:1|2, model, ...}
  created_at  TEXT NOT NULL
);

CREATE TABLE journal ( id INTEGER PRIMARY KEY, asset_id INTEGER REFERENCES assets(id),
  kind TEXT,            -- 'real' | 'paper' | 'observation'
  body TEXT, created_at TEXT NOT NULL );

CREATE TABLE notes ( id INTEGER PRIMARY KEY, asset_id INTEGER REFERENCES assets(id),
  title TEXT, body TEXT, updated_at TEXT NOT NULL );

CREATE TABLE macro ( id INTEGER PRIMARY KEY, series TEXT, value REAL,
  observed_at TEXT, fetched_at TEXT NOT NULL );

CREATE TABLE news ( id INTEGER PRIMARY KEY, title TEXT, url TEXT,
  source TEXT, saved_at TEXT NOT NULL );
```

**Technical learning — why provenance is *separate rows*, never an UPDATE.**
If Tier 2 *edited* the briefing row, the original free-LLM text would be
destroyed — you could never answer "what did the cheap model say before
Claude corrected it?" By making `annotations` append-only rows pointing at
`briefings.id` via a **foreign key**, the audit trail is structurally
guaranteed: history can only grow, never be rewritten. This is the database
equivalent of git — facts are immutable, corrections are new commits.

**Technical learning — composite primary keys as natural deduplication.**
`PRIMARY KEY (asset_id, ts)` on `prices` means re-fetching the same day's
candle and re-inserting is a no-op conflict we can `INSERT OR REPLACE` — the
schema itself prevents duplicate price rows, instead of us writing
de-dupe logic.

---

## 5. The data layer — the `DataSource` abstraction

```python
# datasources/base.py  — the contract every source obeys
class DataSource(Protocol):
    def get_ohlc(self, ticker: str, period: str) -> list[Candle]: ...
    def get_latest(self, ticker: str) -> Quote: ...
```

`yfinance_src.py` implements it via the `yfinance` library; `binance_src.py`
implements it by calling Binance's free public REST endpoint
`/api/v3/klines` (no key). The backend picks the adapter by reading
`assets.asset_class` — `crypto → Binance`, everything else `→ yfinance`.

**Technical learning — what `yfinance` actually does.** It is *not* an
official API. It scrapes/queries Yahoo Finance's internal JSON endpoints.
Consequences we must design for: (1) no SLA — it can break or rate-limit;
(2) equity data is often ~15 min delayed; (3) we must **cache** results in
the `prices` table and not call it on every page render. This is why the
dashboard reads `prices` from SQLite and only triggers a refresh on open or
manual action — not a polling loop hammering Yahoo.

**Technical learning — why an interface (`Protocol`) instead of `if
asset_class == 'crypto'` scattered everywhere.** The signal engine, charts,
and briefing code call `source.get_ohlc(...)` and *do not know or care* which
source it is. Adding a future source (e.g. the deferred Binance websocket) =
write one new class that satisfies the same `Protocol`; nothing else changes.
This is the Dependency Inversion principle, made concrete.

---

## 6. The three tiers, technically

- **Tier 0 — `signals.py`.** Pure functions: `list[Candle] → labels`. No
  network, no AI, no DB inside them (the *caller* persists results). Pure
  functions are trivially testable and can never hallucinate. Examples:
  trend = sign of (50-period MA − 200-period MA); `volume_flag` = today's
  volume vs 20-day average; `vix_regime` = thresholded ^VIX level.
- **Tier 1 — `briefing.py` + `llm.py`, run by `cron_entry.py`.** Builds a
  structured JSON of Tier-0 signals, **segmented by `asset_class`**, and asks
  the free LLM to narrate it into a digest (equities section / crypto section
  / macro) plus one short note per asset. Writes one `briefings` row + N
  `asset_analysis` rows, all stamped `tier:1` provenance.
- **Tier 2 — via `mcp/server.py`.** The strong model reads Tier 0 + Tier 1
  through MCP tools and writes `annotations` (on the digest) or
  `asset_analysis` rows tagged `tier:2` for the 2–3 assets you pick.

**Technical learning — the provider chain / graceful degradation.**
`llm.py` exposes one function `narrate(prompt) -> text`. Internally it tries
Groq; on HTTP error/timeout/quota it falls to OpenRouter; if both fail it
returns a **templated, non-AI** narrative built directly from Tier-0 numbers
("NVDA +2.1% on 1.4× average volume; trend up; VIX calm"). Because all three
providers are OpenAI-compatible, the first two differ only by `base_url`,
api key, and model name — one client, config-swapped. The crucial property:
**the briefing can never fail to exist**, because the last fallback needs no
network and no AI. Tier 0 is the floor the whole system stands on.

---

## 7. The daily cron — how scheduling actually works in Docker

A dedicated tiny container whose only job is to run
`python -m app.cron_entry` at **10:30 America/New_York**. Inside it, a
scheduler (APScheduler, a pure-Python library) holds a cron trigger.

**Technical learning — timezones are a real bug source here.** Containers
default to UTC. "10:30 ET" is 14:30 or 15:30 UTC depending on US daylight
saving. We pin the schedule to the IANA zone `America/New_York` (not a fixed
UTC offset) so the library handles DST transitions for us. We also make
`cron_entry.py` **idempotent**: it checks "is there already a briefing row
for today?" before generating, so a container restart at 10:31 can't produce
two briefings. Idempotency = running it twice has the same effect as once;
it's the standard defense for scheduled jobs.

---

## 8. The MCP server — protocol-level walkthrough

`mcp/server.py` uses the official Python MCP SDK and exposes tools:
`list_assets`, `get_signals(symbol)`, `get_briefing(date)`,
`write_annotation(briefing_id, body)`, `write_asset_analysis(symbol, body)`.
Each tool is a thin wrapper that calls the **same backend service functions**
the cron uses — never raw SQL, never the DB file directly (section 0).

**How you connect it (manual, no API, no cost):** in Claude Desktop's
`claude_desktop_config.json` you add an entry that tells it to launch
`python mcp/server.py` as a subprocess. From then on, in an ordinary Claude
chat, when you say "deep-dive NVDA," Claude sees the tool list, calls
`get_signals`/`get_briefing` over the stdio pipe, reasons, then calls
`write_asset_analysis` — which lands a `tier:2` row in the same SQLite the
dashboard reads.

**Technical learning — why stdio MCP is inherently safe here.** There is no
listening socket, no port, no token. The transport is the OS pipe between a
parent process (Claude Desktop) and a child it spawned. Nothing on your
network can reach it; the attack surface is essentially the local machine
itself. That property is *why* MCP fits a private local-first tool.

---

## 9. The frontend — the parts worth understanding

- **Next.js App Router.** Pages are React Server Components by default;
  interactive bits (charts, editors) are marked `"use client"`. For a
  local single-user tool we mostly want client components that fetch from
  :8081 — simple and obvious over clever server-side data fetching.
- **`lib/api.ts`.** One typed module wrapping `fetch` to the backend. The
  frontend never knows SQL exists — it only knows the JSON contract. If the
  backend storage ever changed, the UI wouldn't.
- **Chart component.** Creates a lightweight-charts instance in `useEffect`,
  `setData()` with OHLC from the API, returns a cleanup that calls
  `chart.remove()`. **Technical learning:** mismatching imperative-library
  lifecycles with React's render cycle is the #1 source of chart memory
  leaks — the cleanup function is not optional, it's the contract.
- **Archive view.** A date picker → `GET /briefings?date=…` →
  rich-rendered briefing + its annotations stacked beneath, each with a
  provenance badge. This *is* the "Notion feel," delivered as UI over SQLite.

---

## 10. Phased build plan (dependency-ordered)

Each phase is independently runnable and verifiable before the next. We do
**not** start a phase until you've seen the previous one work.

| Phase | Deliverable | What it teaches you |
|---|---|---|
| **1. Skeleton + Docker** | `docker compose up` brings up empty FastAPI (:8081 `/health`) + Next.js (:3000) + a persistent SQLite volume | how the services wire together; ASGI; compose volumes |
| **2. Asset registry + schema** | DB created with WAL/FKs; assets seeded; `GET /assets` works | SQLite schema design, migrations, assets-as-data |
| **3. Data layer** | `DataSource` interface + yfinance & Binance adapters; `prices` cached; `GET /assets/{s}/ohlc` | abstraction/Protocol, caching, why yfinance is fragile |
| **4. Charts** | Asset detail page renders a lightweight-charts candlestick from the API | imperative-lib ↔ React lifecycle |
| **5. Tier 0 signals** | `signals.py` pure functions; `signals` table; watchlist table in UI with trend/volume/status | pure functions, testability, deterministic core |
| **6. Tier 1 briefing + cron** | `llm.py` provider chain; `briefing.py`; cron container at 10:30 ET; segmented digest + per-asset notes in DB | scheduling, idempotency, graceful degradation |
| **7. Archive UI** | Date-browsable briefings + provenance badges | presentation vs storage separation |
| **8. MCP server** | MCP tools; connect Claude Desktop; Tier-2 annotate + deep-dive writes back | MCP protocol, stdio transport, one-store/many-writers |
| **9. Journal + notes** | Journal kinds + Notion-like notes editor | rich-text UX, same-store discipline |
| **10. Macro + news + polish** | FRED macro, saved news, dashboard cards, dark Apple-like polish | bringing the surface together |

Deferred-but-seamed (explicitly *not* MVP): Binance **websocket** live
overlay; Markdown export of briefings; per-asset auto-note batching.

---

## 11. Open risks I want you aware of before we start

1. **Free-LLM provider drift.** Groq/OpenRouter rotate and deprecate model
   names. Mitigation: model name is config, and the templated fallback means
   the product still works the day a provider breaks. You should expect to
   occasionally update a model string in `.env`.
2. **yfinance fragility.** It can rate-limit or briefly break. Mitigation:
   the `prices` cache means a fetch failure degrades to slightly stale data,
   not a broken dashboard.
3. **Free crypto API reliability.** Binance public REST is solid but rate
   limited per IP; our once-per-refresh usage is far inside it.
4. **First-run empty states.** Before the first 10:30 cron, there is no
   briefing. The UI must show a clean "no briefing yet — first one generates
   at 10:30 ET" state, not an error. We design empty states from phase 1.

---

## 12. What I need from you before Phase 1

- Confirm this structure and the schema look right to you.
- Confirm the phase order — anything you want pulled earlier/later.
- Any concept above you want expanded *more* deeply before we build it.
```
