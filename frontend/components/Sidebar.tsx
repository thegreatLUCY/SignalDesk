"use client";

// The watchlist rail + the new "Add asset" search popover.
//
// Membership = the `enabled` flag on a row. Add = PATCH enabled:true,
// Remove = PATCH enabled:false. Hidden rows live in the same /assets
// response (via ?include_disabled=true) and are filtered into a search
// pool here — they incur ZERO backend compute because every analysis
// path filters on enabled_only=True.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  getAllAssets,
  getWatchlistSignals,
  patchAssetEnabled,
  type Asset,
  type WatchlistSignal,
} from "@/lib/api";

const ORDER_KEY = "signaldesk:sidebar-order";
type GroupKey = "markets" | "crypto";
type Order = Record<GroupKey, string[]>;

const GROUP_LABEL: Record<GroupKey, string> = {
  markets: "Equities",
  crypto: "Crypto",
};

function groupOf(a: Asset): GroupKey {
  return a.asset_class === "crypto" ? "crypto" : "markets";
}

function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  const dp = v >= 100 ? 2 : v >= 1 ? 2 : 4;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function applyOrder(assets: Asset[], saved: string[]): Asset[] {
  const pos = new Map(saved.map((s, i) => [s, i]));
  return [...assets].sort((x, y) => {
    const px = pos.has(x.symbol) ? pos.get(x.symbol)! : Number.MAX_SAFE_INTEGER;
    const py = pos.has(y.symbol) ? pos.get(y.symbol)! : Number.MAX_SAFE_INTEGER;
    return px - py;
  });
}

function BrandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <rect x="3" y="11" width="3" height="6" rx="0.5" fill="currentColor" />
      <rect x="8.5" y="7" width="3" height="10" rx="0.5" fill="currentColor" />
      <rect x="14" y="3" width="3" height="14" rx="0.5" fill="currentColor" />
    </svg>
  );
}

// Matches a query against symbol AND aliases, case-insensitive substring.
function matchesQuery(a: Asset, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (a.symbol.toLowerCase().includes(needle)) return true;
  return a.aliases.some((al) => al.toLowerCase().includes(needle));
}

export default function Sidebar({
  activeA,
  activeB,
  compare,
  collapsed,
  onToggleCollapse,
  onToggleCompare,
  onPick,
}: {
  activeA: string | null;
  activeB: string | null;
  compare: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleCompare: () => void;
  onPick: (symbol: string, additive: boolean) => void;
}) {
  // One fetch returns everything; we split into watchlist + search pool.
  const [allAssets, setAllAssets] = useState<Asset[] | null>(null);
  const [sigs, setSigs] = useState<Record<string, WatchlistSignal>>({});
  const [error, setError] = useState<string | null>(null);
  const [sigErr, setSigErr] = useState(false);
  const [order, setOrder] = useState<Order>({ markets: [], crypto: [] });
  const [drag, setDrag] = useState<{ sym: string; group: GroupKey } | null>(
    null,
  );
  const [overSym, setOverSym] = useState<string | null>(null);

  // "+ Add" popover state — picker open/closed, search query, in-flight
  // network indicator for the click-to-add action.
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw));
    } catch {
      /* corrupt/empty localStorage is fine — fall back to default order */
    }
    getAllAssets()
      .then(setAllAssets)
      .catch((e) => setError(String(e)));
    getWatchlistSignals()
      .then((rows) =>
        setSigs(Object.fromEntries(rows.map((r) => [r.symbol, r]))),
      )
      .catch(() => setSigErr(true));
  }, []);

  // Outside-click + Esc close the picker. Auto-focus the search on open.
  useEffect(() => {
    if (!picker) return;
    queryRef.current?.focus();
    function onDoc(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setPicker(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPicker(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker]);

  const enabledAssets = useMemo(
    () => (allAssets ?? []).filter((a) => a.enabled),
    [allAssets],
  );
  const hiddenAssets = useMemo(
    () =>
      (allAssets ?? [])
        .filter((a) => !a.enabled)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allAssets],
  );

  const grouped = useMemo(() => {
    const base: Record<GroupKey, Asset[]> = { markets: [], crypto: [] };
    for (const a of enabledAssets) base[groupOf(a)].push(a);
    return {
      markets: applyOrder(base.markets, order.markets),
      crypto: applyOrder(base.crypto, order.crypto),
    };
  }, [enabledAssets, order]);

  const filteredHidden = useMemo(
    () => hiddenAssets.filter((a) => matchesQuery(a, query)),
    [hiddenAssets, query],
  );

  function persist(next: Order) {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — order just won't persist, no crash */
    }
  }

  function handleDrop(group: GroupKey, targetSym: string) {
    setOverSym(null);
    if (!drag || drag.group !== group || drag.sym === targetSym) return;
    const list = grouped[group].map((a) => a.symbol);
    const from = list.indexOf(drag.sym);
    const to = list.indexOf(targetSym);
    list.splice(to, 0, list.splice(from, 1)[0]);
    persist({ ...order, [group]: list });
    setDrag(null);
  }

  async function toggleEnabled(symbol: string, enabled: boolean) {
    setBusy(true);
    try {
      const next = await patchAssetEnabled(symbol, enabled);
      setAllAssets(next);
      if (enabled) {
        // Just-added — also pull fresh signals so the new row shows price/%
        // right away instead of dashes until next reload.
        getWatchlistSignals()
          .then((rows) =>
            setSigs(Object.fromEntries(rows.map((r) => [r.symbol, r]))),
          )
          .catch(() => {});
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const liveOk = !error && !sigErr;

  const renderGroup = (group: GroupKey) => {
    const rows = grouped[group];
    if (rows.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="flex items-center justify-between px-2 pb-1 pt-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            {GROUP_LABEL[group]}
          </span>
          <span className="text-[10px] tabular-nums text-neutral-700">
            {rows.length}
          </span>
        </div>
        {rows.map((a) => {
          const isA = a.symbol === activeA;
          const isB = a.symbol === activeB;
          const s = sigs[a.symbol];
          const pct = s?.pct_change ?? null;
          const pctClass =
            pct === null
              ? "text-neutral-600"
              : pct > 0
                ? "text-emerald-400"
                : pct < 0
                  ? "text-red-400"
                  : "text-neutral-400";
          return (
            <div
              key={a.id}
              draggable
              onDragStart={() => setDrag({ sym: a.symbol, group })}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag?.group === group) setOverSym(a.symbol);
              }}
              onDrop={() => handleDrop(group, a.symbol)}
              onDragEnd={() => {
                setDrag(null);
                setOverSym(null);
              }}
              onClick={(e) =>
                onPick(a.symbol, compare || e.metaKey || e.ctrlKey)
              }
              role="button"
              tabIndex={0}
              aria-pressed={isA || isB}
              aria-label={`${a.symbol}${
                isA ? " — open as chart A" : isB ? " — open as chart B" : ""
              }`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(a.symbol, compare);
                }
              }}
              className={`group relative flex cursor-pointer items-start justify-between gap-3 rounded-md border-t px-2 py-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sky-500/60 ${
                isA || isB
                  ? "bg-neutral-800/80"
                  : "hover:bg-neutral-900"
              } ${
                overSym === a.symbol && drag?.group === group
                  ? "border-sky-500/70"
                  : "border-transparent"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-100">
                    {a.symbol}
                  </span>
                  {isA && (
                    <span className="rounded bg-sky-500/20 px-1 text-[10px] font-medium text-sky-400">
                      A
                    </span>
                  )}
                  {isB && (
                    <span className="rounded bg-violet-500/20 px-1 text-[10px] font-medium text-violet-400">
                      B
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-neutral-500">
                  <span>
                    RSI{" "}
                    <span className="text-neutral-300">
                      {s?.rsi ?? "—"}
                    </span>
                  </span>
                  <span>
                    ATR{" "}
                    <span className="text-neutral-300">
                      {s?.atr_pct === null || s?.atr_pct === undefined
                        ? "—"
                        : `${s.atr_pct}%`}
                    </span>
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span className="text-sm font-semibold tabular-nums text-neutral-100">
                  {fmtPrice(s?.last_close ?? null)}
                </span>
                <span className={`text-[11px] tabular-nums ${pctClass}`}>
                  {pct === null
                    ? "—"
                    : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                </span>
              </div>
              {/* Hover × — removes the row from the watchlist (sets
                  enabled=false). stopPropagation so the row's onClick
                  doesn't pick the asset at the same time. */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleEnabled(a.symbol, false);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                title={`Remove ${a.symbol} from watchlist (kept hidden)`}
                aria-label={`Remove ${a.symbol} from watchlist`}
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded text-neutral-600 hover:bg-neutral-800 hover:text-red-400 group-hover:flex"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  // Collapsed: a slim rail that only offers "expand" — charts get the width.
  if (collapsed) {
    return (
      <aside className="flex h-screen w-12 shrink-0 flex-col items-center border-r border-neutral-800 bg-neutral-950 py-4 transition-[width] duration-200">
        <button
          onClick={onToggleCollapse}
          title="Expand watchlist"
          aria-label="Expand watchlist"
          className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
        >
          »
        </button>
        <div className="mt-4 origin-center -rotate-90 select-none whitespace-nowrap text-[10px] uppercase tracking-widest text-neutral-700">
          watchlist
        </div>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-screen w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 transition-[width] duration-200">
      {/* Brand header — icon tile + name; right side: LIVE pill, + (add), «  */}
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-neutral-300">
            <BrandIcon />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-wide text-neutral-100">
              SIGNALDESK
            </div>
            <div className="truncate text-[10px] text-neutral-500">
              market analysis workstation
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest ${
              liveOk
                ? "border-emerald-700/50 bg-emerald-600/15 text-emerald-300"
                : "border-red-700/50 bg-red-600/15 text-red-300"
            }`}
            title={liveOk ? "Backend reachable" : "Backend unreachable"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                liveOk
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                  : "bg-red-400"
              }`}
            />
            {liveOk ? "live" : "offline"}
          </span>
          <button
            onClick={() => setPicker((v) => !v)}
            title="Add asset to watchlist"
            aria-label="Add asset to watchlist"
            aria-expanded={picker}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-base leading-none transition-colors ${
              picker
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            +
          </button>
          <button
            onClick={onToggleCollapse}
            title="Collapse watchlist"
            aria-label="Collapse watchlist"
            className="rounded-md px-1.5 py-0.5 text-sm text-neutral-600 hover:bg-neutral-900 hover:text-neutral-200"
          >
            «
          </button>
        </div>
      </div>

      {/* Add-asset popover — searches the hidden pool, click to enable.
          Absolutely positioned so it overlays the rail content without
          shifting it. */}
      {picker && (
        <div
          ref={pickerRef}
          className="absolute left-3 right-3 top-[60px] z-30 max-h-[60vh] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/50"
        >
          <div className="border-b border-neutral-800 p-2">
            <input
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol or name…"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
          </div>
          <div className="max-h-[48vh] overflow-y-auto py-1">
            {filteredHidden.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-neutral-600">
                {hiddenAssets.length === 0
                  ? "Nothing else to add."
                  : "No matches."}
              </p>
            ) : (
              filteredHidden.map((a) => (
                <button
                  key={a.id}
                  disabled={busy}
                  onClick={() => toggleEnabled(a.symbol, true)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-neutral-900 disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-neutral-100">
                      {a.symbol}
                    </div>
                    {a.aliases.length > 0 && (
                      <div className="truncate text-[10px] text-neutral-600">
                        {a.aliases.slice(0, 2).join(" · ")}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest ${
                      a.asset_class === "crypto"
                        ? "bg-amber-600/20 text-amber-400"
                        : a.asset_class === "index"
                          ? "bg-violet-600/20 text-violet-400"
                          : "bg-sky-600/20 text-sky-400"
                    }`}
                  >
                    {a.asset_class}
                  </span>
                  <span className="text-neutral-600">+</span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-neutral-800 px-3 py-1.5 text-[10px] uppercase tracking-widest text-neutral-700">
            {filteredHidden.length} hidden · click to add · esc closes
          </div>
        </div>
      )}

      {/* Compare control — restyled bordered pill, same on/off behaviour. */}
      <button
        onClick={onToggleCompare}
        className={`mx-3 mb-3 flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] uppercase tracking-wide transition-colors ${
          compare
            ? "border-emerald-700/50 bg-emerald-600/15 text-emerald-300"
            : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-300"
        }`}
        title="When on, the next pick opens a second chart (or ⌘/Ctrl-click)"
      >
        <span className="tracking-widest">Compare</span>
        <span className={compare ? "text-emerald-400" : "text-neutral-600"}>
          {compare ? "ON" : "OFF"}
        </span>
      </button>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {error && (
          <p className="px-2 py-2 text-xs text-red-400">API: {error}</p>
        )}
        {allAssets === null && !error ? (
          <p className="px-2 py-2 text-xs text-neutral-500">loading…</p>
        ) : (
          <>
            {renderGroup("markets")}
            {renderGroup("crypto")}
          </>
        )}
      </div>
    </aside>
  );
}
