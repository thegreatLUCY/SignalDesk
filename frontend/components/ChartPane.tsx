"use client";

// One chart pane: price + Tier 0 signals. Two requested features, one UI:
// a LEGEND that shows color→meaning AND is the per-signal toggle, plus a
// master all-on/off. All inline in the pane — no navigation, single-screen.

import { type ReactNode, useEffect, useMemo, useState } from "react";

import CandleChart, { type Overlay } from "@/components/CandleChart";
import {
  getOhlc,
  getSignals,
  type AssetSignals,
  type Ohlc,
} from "@/lib/api";

// Match the design ref's full range strip. Each is just a `days` value the
// existing get_ohlc/get_signals already accept — no new endpoints.
const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "MAX", days: 1825 }, // ~5y is "long enough" for this tool
];

// Price formatting adapts to magnitude (a $4 token and a $77k BTC shouldn't
// share precision). Same pattern Sidebar uses.
function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  const dp = v >= 100 ? 2 : v >= 1 ? 2 : 4;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

// ONE place mapping an overlay key → its label + color. Backend just sends
// keyed series; adding a new overlay later is a line here, not new plumbing.
const OVERLAY_DEFS: { key: string; label: string; color: string }[] = [
  { key: "ma20", label: "MA20", color: "#38bdf8" },
  { key: "ma50", label: "MA50", color: "#f59e0b" },
  { key: "ma100", label: "MA100", color: "#a78bfa" },
  { key: "bb_upper", label: "Boll↑", color: "#22d3ee" },
  { key: "bb_lower", label: "Boll↓", color: "#22d3ee" },
  { key: "hi_252", label: "52w Hi", color: "#34d399" },
  { key: "lo_252", label: "52w Lo", color: "#f87171" },
];

// A labeled, bordered metric pill. The label (faint) + border guarantee
// metrics never visually run into each other — that was the original bug.
function Pill({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5">
      <span className="text-neutral-500">{label}</span>
      {children}
    </span>
  );
}

function pctColor(v: number | null) {
  if (v === null) return "text-neutral-500";
  return v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-neutral-400";
}

function rsiColor(zone: string | null) {
  if (zone === "overbought") return "text-red-400";
  if (zone === "oversold") return "text-emerald-400";
  return "text-neutral-400";
}

export default function ChartPane({
  symbol,
  slot,
  onClose,
}: {
  symbol: string;
  slot: "A" | "B";
  onClose: () => void;
}) {
  const [days, setDays] = useState(180);
  const [data, setData] = useState<Ohlc | null>(null);
  const [sig, setSig] = useState<AssetSignals | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-signal on/off. Default: everything on. Master button flips them all.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(OVERLAY_DEFS.map((d) => [d.key, true])),
  );
  const allOn = OVERLAY_DEFS.every((d) => enabled[d.key]);

  useEffect(() => {
    let cancelled = false; // async-race guard (Phase 4 lesson)
    setData(null);
    setSig(null);
    setError(null);
    Promise.all([getOhlc(symbol, days), getSignals(symbol, days)])
      .then(([ohlc, signals]) => {
        if (cancelled) return;
        setData(ohlc);
        setSig(signals);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [symbol, days]);

  // Memoized for stable identity (Phase 5 lesson): only the enabled +
  // non-empty series become chart lines.
  const overlays = useMemo<Overlay[]>(() => {
    if (!sig) return [];
    return OVERLAY_DEFS.filter(
      (d) => enabled[d.key] && (sig.lines[d.key]?.length ?? 0) > 0,
    ).map((d) => ({
      label: d.label,
      color: d.color,
      data: sig.lines[d.key],
    }));
  }, [sig, enabled]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
      {/* Row 1: identity + price + range / close.
          Restyled to the Remake ref: tile-style slot badge, large symbol +
          inline price + pct, full range strip. All data already on `sig`. */}
      <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${
              slot === "A"
                ? "bg-sky-500/20 text-sky-400"
                : "bg-violet-500/20 text-violet-400"
            }`}
            title={`Slot ${slot}`}
          >
            {slot}
          </span>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="truncate text-2xl font-bold tracking-tight text-neutral-100">
              {symbol}
            </span>
            {sig && sig.last_close !== null && (
              <span className="text-2xl font-medium tabular-nums text-neutral-100">
                {fmtPrice(sig.last_close)}
              </span>
            )}
            {sig && sig.pct_change !== null && (
              <span
                className={`text-sm font-semibold tabular-nums ${pctColor(
                  sig.pct_change,
                )}`}
              >
                {sig.pct_change > 0 ? "+" : ""}
                {sig.pct_change}%
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                days === r.days
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="ml-1 rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            title="close pane"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Row 2: metric pills — each labeled + bordered so they never run
          together (the bug was adjacent unlabeled spans). */}
      {sig && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2.5 pt-2 text-[11px]">
          <Pill label="trend">
            <span className="text-neutral-200">
              {sig.trend === "up" ? "▲ " : sig.trend === "down" ? "▼ " : "• "}
              {sig.status}
            </span>
          </Pill>
          <Pill label="RSI">
            <span className={rsiColor(sig.rsi_zone)}>
              {sig.rsi ?? "—"}
              {sig.rsi_zone && sig.rsi_zone !== "neutral"
                ? ` ${sig.rsi_zone}`
                : ""}
            </span>
          </Pill>
          <Pill label="ATR">
            <span className="text-neutral-200">
              {sig.atr_pct === null ? "—" : `${sig.atr_pct}%`}
            </span>
          </Pill>
          <Pill label="vs 52w hi">
            <span className="text-neutral-200">
              {sig.dist_high_pct === null ? "—" : `${sig.dist_high_pct}%`}
            </span>
          </Pill>
          {sig.volume_flag && sig.volume_flag !== "normal" && (
            <Pill label="vol">
              <span className="text-amber-400">{sig.volume_flag}</span>
            </Pill>
          )}
        </div>
      )}

      {/* Row 3: legend = per-signal toggles. Colored swatch shows which line
          on the chart; click toggles it. Off = readable + dimmed (no
          hard-to-read strikethrough), with a hollow swatch as the cue. */}
      <div className="flex flex-wrap items-center gap-1.5 border-y border-neutral-800 bg-neutral-950/40 px-4 py-2">
        <button
          onClick={() => {
            const next = !allOn;
            setEnabled(
              Object.fromEntries(OVERLAY_DEFS.map((d) => [d.key, next])),
            );
          }}
          className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300 hover:bg-neutral-800"
          title="Master: show or hide every signal (hide = clean chart)"
        >
          {allOn ? "hide all" : "show all"}
        </button>
        <span className="mx-0.5 h-3 w-px bg-neutral-800" />
        {OVERLAY_DEFS.map((d) => {
          const on = enabled[d.key];
          return (
            <button
              key={d.key}
              onClick={() =>
                setEnabled((e) => ({ ...e, [d.key]: !e[d.key] }))
              }
              className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                on
                  ? "text-neutral-200 hover:bg-neutral-800"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              title={`${on ? "Hide" : "Show"} ${d.label}`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full border"
                style={{
                  borderColor: d.color,
                  backgroundColor: on ? d.color : "transparent",
                }}
              />
              {d.label}
            </button>
          );
        })}
      </div>

      {/* min-h-0 lets this chart area shrink inside a user-resized
          workspace instead of forcing the pane to overflow (the flexbox
          min-content trap that caused the dock-clip bug). */}
      <div className="min-h-0 flex-1 p-3">
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-red-400">
            {error}
          </div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            loading {symbol}…
          </div>
        ) : data.candles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            no price data for {symbol}
          </div>
        ) : (
          <CandleChart candles={data.candles} overlays={overlays} />
        )}
      </div>
    </div>
  );
}
