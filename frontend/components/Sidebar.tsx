"use client";

// The persistent watchlist rail, now grouped (Equities & Indices / Crypto)
// with TradingView-style drag-to-reorder inside each group.
//
// Two learning points here:
//  • Native HTML5 drag-and-drop (draggable + onDragStart/Over/Drop) — no
//    library. The browser already ships this; reorder is just array surgery.
//  • Order is persisted in localStorage, NOT the DB: it's a cosmetic view
//    preference with no meaning to signals/briefing/MCP. Don't couple
//    cosmetics to the shared source of truth.

import { useEffect, useMemo, useState } from "react";

import {
  getAssets,
  getWatchlistSignals,
  type Asset,
  type WatchlistSignal,
} from "@/lib/api";

const ORDER_KEY = "signaldesk:sidebar-order";
type GroupKey = "markets" | "crypto";
type Order = Record<GroupKey, string[]>;

const GROUP_LABEL: Record<GroupKey, string> = {
  markets: "Equities & Indices",
  crypto: "Crypto",
};

function groupOf(a: Asset): GroupKey {
  return a.asset_class === "crypto" ? "crypto" : "markets";
}

// Price formatting that adapts to magnitude (a $4 token and a $77,000 BTC
// shouldn't use the same precision). Thousands separators for readability.
function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  const dp = v >= 100 ? 2 : v >= 1 ? 2 : 4;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

// Apply a saved symbol order to a group's assets: known symbols first in the
// saved sequence, any new/unknown asset appended in its original order.
function applyOrder(assets: Asset[], saved: string[]): Asset[] {
  const pos = new Map(saved.map((s, i) => [s, i]));
  return [...assets].sort((x, y) => {
    const px = pos.has(x.symbol) ? pos.get(x.symbol)! : Number.MAX_SAFE_INTEGER;
    const py = pos.has(y.symbol) ? pos.get(y.symbol)! : Number.MAX_SAFE_INTEGER;
    return px - py;
  });
}

export default function Sidebar({
  activeA,
  activeB,
  compare,
  onToggleCompare,
  onPick,
}: {
  activeA: string | null;
  activeB: string | null;
  compare: boolean;
  onToggleCompare: () => void;
  onPick: (symbol: string, additive: boolean) => void;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [sigs, setSigs] = useState<Record<string, WatchlistSignal>>({});
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>({ markets: [], crypto: [] });
  const [drag, setDrag] = useState<{ sym: string; group: GroupKey } | null>(
    null,
  );
  const [overSym, setOverSym] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw));
    } catch {
      /* corrupt/empty localStorage is fine — fall back to default order */
    }
    getAssets()
      .then(setAssets)
      .catch((e) => setError(String(e)));
    getWatchlistSignals()
      .then((rows) =>
        setSigs(Object.fromEntries(rows.map((r) => [r.symbol, r]))),
      )
      .catch(() => {});
  }, []);

  const grouped = useMemo(() => {
    const base: Record<GroupKey, Asset[]> = { markets: [], crypto: [] };
    for (const a of assets ?? []) base[groupOf(a)].push(a);
    return {
      markets: applyOrder(base.markets, order.markets),
      crypto: applyOrder(base.crypto, order.crypto),
    };
  }, [assets, order]);

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
    list.splice(to, 0, list.splice(from, 1)[0]); // remove dragged, insert at target
    persist({ ...order, [group]: list });
    setDrag(null);
  }

  const renderGroup = (group: GroupKey) => (
    <div className="mb-3">
      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        {GROUP_LABEL[group]}
      </div>
      {grouped[group].map((a) => {
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
        const arrow =
          s?.trend === "up" ? "▲" : s?.trend === "down" ? "▼" : "·";
        return (
          <div
            key={a.id}
            draggable
            onDragStart={() => setDrag({ sym: a.symbol, group })}
            onDragOver={(e) => {
              e.preventDefault(); // required to allow a drop
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
            className={`mb-0.5 flex cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors ${
              isA || isB
                ? "bg-neutral-800 text-white"
                : "text-neutral-300 hover:bg-neutral-900"
            } ${
              overSym === a.symbol && drag?.group === group
                ? "border-t-2 border-sky-500"
                : "border-t-2 border-transparent"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span className="select-none text-neutral-700">⠿</span>
              <span className="text-sm font-medium">{a.symbol}</span>
              {isA && (
                <span className="rounded bg-sky-500/20 px-1 text-[10px] text-sky-400">
                  A
                </span>
              )}
              {isB && (
                <span className="rounded bg-violet-500/20 px-1 text-[10px] text-violet-400">
                  B
                </span>
              )}
            </span>
            <span className="flex flex-col items-end leading-tight">
              <span className="text-sm tabular-nums text-neutral-200">
                {fmtPrice(s?.last_close ?? null)}
              </span>
              <span
                className={`flex items-center gap-1 text-[11px] tabular-nums ${pctClass}`}
              >
                <span className="text-neutral-500">{arrow}</span>
                {pct === null
                  ? "—"
                  : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="px-4 pb-3 pt-5">
        {/* Logo is a transparent PNG (tight-cropped) — sits cleanly on the
            dark rail. Plain <img>: it's a static asset in /public, no need
            for next/image optimization machinery here. */}
        <img
          src="/logo.png"
          alt="SignalDesk — Market Analysis & Insights"
          className="w-full select-none"
          draggable={false}
        />
      </div>

      <button
        onClick={onToggleCompare}
        className={`mx-3 mb-2 rounded-md px-2 py-1 text-[11px] uppercase tracking-wide ${
          compare
            ? "bg-emerald-600/20 text-emerald-400"
            : "bg-neutral-900 text-neutral-500 hover:text-neutral-300"
        }`}
        title="When on, the next pick opens a second chart (or ⌘/Ctrl-click)"
      >
        {compare ? "compare: on" : "compare: off"}
      </button>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {error && (
          <p className="px-2 py-2 text-xs text-red-400">API: {error}</p>
        )}
        {assets === null && !error ? (
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
