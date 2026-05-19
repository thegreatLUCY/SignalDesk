"use client";

// Owns the SELECTION, stored in the URL (?a=AAPL&b=BTC-USD). URL-as-state:
// the screen is cohesive AND every view stays bookmarkable / reloadable /
// shareable. Because selection is just query params on one route, the whole
// shell (sidebar + workspace) never unmounts — it just re-renders.
//
// It also owns three LAYOUT prefs (all persisted, all reproducing today's
// layout by default):
//   • sidebar collapsed  → charts gain width
//   • desk open/closed   → owned here so it can drive the vertical split
//   • workspace height    → user-draggable when the desk is open; the desk
//     then takes the remainder and scrolls INSIDE it (this is what fixes
//     the old "dock pushed off-screen, can't scroll" clip).

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import BriefingBar from "@/components/BriefingBar";
import DeskDock from "@/components/DeskDock";
import Sidebar from "@/components/Sidebar";
import Workspace from "@/components/Workspace";

const COLLAPSE_KEY = "signaldesk:sidebar-collapsed";
const WS_KEY = "signaldesk:workspace-h";
const MIN_WS = 320; // chart pane stays usable below this we don't go

function viewportH(): number {
  return typeof window === "undefined" ? 900 : window.innerHeight;
}
// Leave at least this much for the (header + scrollable) desk region.
function clampWs(h: number): number {
  return Math.max(MIN_WS, Math.min(h, viewportH() - 180));
}

export default function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const a = params.get("a");
  const b = params.get("b");

  // "armed" = user explicitly turned compare on while only one chart is open
  // (so the next plain click adds a 2nd). The toggle the user SEES is derived
  // so it can never disagree with reality (two charts open ⇒ comparing).
  const [armed, setArmed] = useState(false);
  const compareActive = armed || Boolean(b);

  // ── layout prefs ────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [wsH, setWsH] = useState<number | null>(null);

  // Read persisted prefs after mount (avoids any SSR/hydration mismatch —
  // the first client render matches the server's default, then we sync).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
      const v = localStorage.getItem(WS_KEY);
      if (v) setWsH(clampWs(parseInt(v, 10)));
    } catch {
      /* private mode / no storage — defaults are fine */
    }
  }, []);

  // First time the desk opens with no saved size, seed a sensible split.
  useEffect(() => {
    if (deskOpen && wsH === null) setWsH(clampWs(Math.round(viewportH() * 0.55)));
  }, [deskOpen, wsH]);

  // Keep the split valid if the window is resized smaller.
  useEffect(() => {
    function onResize() {
      setWsH((h) => (h === null ? h : clampWs(h)));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* no-op */
      }
      return next;
    });
  }

  // ── workspace resize grip (pointer events + capture = robust drag) ───────
  const drag = useRef<{ y: number; h: number } | null>(null);
  const onGripDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, h: wsH ?? clampWs(viewportH() * 0.55) };
    },
    [wsH],
  );
  const onGripMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    // Drag DOWN ⇒ taller chart workspace ⇒ shorter desk. Intuitive.
    setWsH(clampWs(drag.current.h + (e.clientY - drag.current.y)));
  }, []);
  const onGripUp = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // Persist size (cheap; effect keeps it in sync after any change/drag).
  useEffect(() => {
    if (wsH === null) return;
    try {
      localStorage.setItem(WS_KEY, String(wsH));
    } catch {
      /* no-op */
    }
  }, [wsH]);

  // ── selection (unchanged) ───────────────────────────────────────────────
  function apply(nextA: string | null, nextB: string | null) {
    const q = new URLSearchParams();
    if (nextA) q.set("a", nextA);
    if (nextB) q.set("b", nextB);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }
  function onPick(symbol: string, additive: boolean) {
    if (additive && a && symbol !== a) apply(a, symbol);
    else apply(symbol, b === symbol ? null : b);
  }
  function onCloseA() {
    apply(b, null);
  }
  function onCloseB() {
    apply(a, null);
  }
  function onToggleCompare() {
    if (compareActive) {
      setArmed(false);
      if (b) apply(a, null);
    } else {
      setArmed(true);
    }
  }

  const effWsH = wsH ?? Math.round(viewportH() * 0.55);

  return (
    <div className="flex h-screen">
      <Sidebar
        activeA={a}
        activeB={b}
        compare={compareActive}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onToggleCompare={onToggleCompare}
        onPick={onPick}
      />
      <main className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        <BriefingBar />

        {/* Desk CLOSED → workspace is flex-1 (fills, exactly as before).
            Desk OPEN  → workspace is a fixed, user-resizable height and the
            desk below becomes flex-1 + internally scrollable. */}
        <div
          className={
            deskOpen ? "relative min-h-0 shrink-0" : "relative min-h-0 flex-1"
          }
          style={deskOpen ? { height: effWsH } : undefined}
        >
          <Workspace a={a} b={b} onCloseA={onCloseA} onCloseB={onCloseB} />

          {deskOpen && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize charts vs desk"
              onPointerDown={onGripDown}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              title="Drag to resize charts ↕"
              className="absolute bottom-1 right-1 flex h-5 w-5 cursor-ns-resize items-end justify-end rounded text-neutral-600 hover:text-neutral-300"
            >
              {/* corner grip glyph — subtle, only while there's a split */}
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M11 4 4 11M11 8 8 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </div>
          )}
        </div>

        <DeskDock
          activeSymbol={a}
          open={deskOpen}
          onToggle={() => setDeskOpen((v) => !v)}
        />
      </main>
    </div>
  );
}
