// One typed module wrapping every call to the backend. The rest of the
// frontend imports from here and never touches `fetch` or URLs directly —
// so the UI only knows the JSON *contract*, not that SQLite/yfinance exist
// behind it. Change the backend internals, the UI doesn't care.

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8081";

export type Asset = {
  id: number;
  symbol: string;
  yf_ticker: string | null;
  asset_class: string;
  aliases: string[];
  enabled: boolean;
};

export type Candle = {
  time: string; // 'YYYY-MM-DD' — already chart-ready (decided in Phase 3)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Ohlc = {
  symbol: string;
  asset_class: string;
  source: string; // 'yfinance' | 'binance'
  cached: boolean;
  candles: Candle[];
};

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export type MAPoint = { time: string; value: number };

export type SignalSummary = {
  trend: string | null;
  pct_change: number | null;
  volume_flag: string | null;
  vix_regime: string | null;
  status: string;
  last_close: number | null;
  rsi: number | null;
  rsi_zone: string | null;
  atr_pct: number | null;
  dist_high_pct: number | null;
  dist_low_pct: number | null;
};

export type WatchlistSignal = SignalSummary & {
  symbol: string;
  asset_class: string;
  computed_at: string;
};

export type AssetSignals = SignalSummary & {
  symbol: string;
  computed_at: string;
  lines: Record<string, MAPoint[]>;
};

export const getAssets = () => getJSON<Asset[]>("/assets");

// All assets, INCLUDING hidden (enabled=false). Powers the "+ Add" search
// — the user picks from this pool to flip a row into the active watchlist.
export const getAllAssets = () =>
  getJSON<Asset[]>("/assets?include_disabled=true");

// Flip the watchlist membership. Returns the full updated list so the UI
// can refresh both the watchlist AND the search pool from one response.
export async function patchAssetEnabled(
  symbol: string,
  enabled: boolean,
): Promise<Asset[]> {
  const res = await fetch(
    `${API_BASE}/assets/${encodeURIComponent(symbol)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok)
    throw new Error(`API ${res.status} toggling ${symbol}`);
  return res.json();
}

export const getWatchlistSignals = () =>
  getJSON<WatchlistSignal[]>("/signals");

export const getSignals = (symbol: string, days = 180) =>
  getJSON<AssetSignals>(
    `/assets/${encodeURIComponent(symbol)}/signals?days=${days}`,
  );

export type Briefing = {
  id: number;
  date: string;
  body: string;
  provenance: {
    tier: number;
    provider: string; // 'groq' | 'openrouter' | 'template'
    model: string;
    generated_at?: string;
    vix_regime?: string | null;
    risk_stance?: string; // 'risk-on' | 'neutral' | 'risk-off' (deterministic)
  };
  created_at: string;
};

export type Annotation = {
  id: number;
  briefing_id: number;
  body: string;
  provenance: { tier: number; provider: string; model: string };
  created_at: string;
};

export type BriefingDetail = Briefing & { annotations: Annotation[] };

export type BriefingListItem = {
  date: string;
  provider: string;
  model: string;
  risk_stance: string | null;
  created_at: string;
};

export const listBriefings = () =>
  getJSON<BriefingListItem[]>("/briefings");

export const getLatestBriefing = () =>
  getJSON<BriefingDetail | null>("/briefings/latest");

export const getBriefingByDate = (date: string) =>
  getJSON<BriefingDetail>(`/briefings/${date}`);

export async function addAnnotation(
  date: string,
  body: string,
): Promise<BriefingDetail> {
  const res = await fetch(`${API_BASE}/briefings/${date}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`API ${res.status} adding annotation`);
  return res.json();
}

export async function runBriefing(force = false): Promise<Briefing> {
  const res = await fetch(`${API_BASE}/briefings/run?force=${force}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`API ${res.status} running briefing`);
  return res.json();
}

export const getOhlc = (symbol: string, days = 180) =>
  getJSON<Ohlc>(`/assets/${encodeURIComponent(symbol)}/ohlc?days=${days}`);

// ── Phase 10: macro + news ─────────────────────────────────────────────────

export type MacroPoint = {
  series: string;
  label: string;
  unit: string;
  value: number | null; // null = FRED gave nothing; UI shows '—'
  observed_at: string | null;
  fetched_at: string | null;
};

export type NewsItem = {
  id: number;
  title: string;
  url: string;
  source: string;
  saved_at: string;
};

export type NewsBrief = {
  body: string;
  provider: string; // 'groq' | 'openrouter' | 'template' | 'none'
  model: string;
  generated_at?: string | null;
};

export const getMacro = () => getJSON<MacroPoint[]>("/macro");
export const getNews = () => getJSON<NewsItem[]>("/news");
export const getNewsBrief = () => getJSON<NewsBrief | null>("/news/brief");

// Crypto Fear & Greed index — alternative.me, deterministic display.
export type FngPoint = {
  value: number;          // 0..100
  label: string;          // "Extreme Fear" … "Extreme Greed"
  observed_at: string | null;
};
export const getFng = () => getJSON<FngPoint | null>("/fng");

// ── Phase 9: journal + notes ───────────────────────────────────────────────

// A tiny helper for the write verbs the journal/notes need. Kept local so
// the read-only getJSON above stays simple.
async function send<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${method} ${path}`);
  return res.json() as Promise<T>;
}

export type JournalEntry = {
  id: number;
  kind: "real" | "paper" | "observation";
  symbol: string | null;
  side: "long" | "short" | null;
  entry: number | null;
  exit: number | null;
  size: number | null;
  status: "open" | "closed";
  thesis: string | null;
  outcome: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  pl_abs: number | null; // computed server-side — never sent by us
  pl_pct: number | null;
};

export type JournalIn = Partial<
  Omit<
    JournalEntry,
    "id" | "created_at" | "updated_at" | "pl_abs" | "pl_pct"
  >
>;

export const listJournal = () => getJSON<JournalEntry[]>("/journal");

export const addJournal = (e: JournalIn) =>
  send<JournalEntry>("POST", "/journal", e);

export const patchJournal = (id: number, p: JournalIn) =>
  send<JournalEntry>("PATCH", `/journal/${id}`, p);

export const deleteJournal = (id: number) =>
  send<{ ok: boolean }>("DELETE", `/journal/${id}`);

export type Note = {
  id: number;
  symbol: string | null;
  title: string | null;
  body: string | null;
  pinned: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type NoteIn = {
  title?: string;
  body?: string;
  symbol?: string | null;
  pinned?: boolean;
};

export const listNotes = () => getJSON<Note[]>("/notes");

export const addNote = (n: NoteIn) => send<Note>("POST", "/notes", n);

export const patchNote = (id: number, p: NoteIn) =>
  send<Note>("PATCH", `/notes/${id}`, p);

export const deleteNote = (id: number) =>
  send<{ ok: boolean }>("DELETE", `/notes/${id}`);

// POST = explicitly spend the LLM call (the "summarise" button). GET
// (getNewsBrief) only returns a cached one — quota is never burned on view.
export const makeNewsBrief = () => send<NewsBrief>("POST", "/news/brief");
