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
