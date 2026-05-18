"use client";

// Owns the SELECTION, stored in the URL (?a=AAPL&b=BTC-USD). URL-as-state:
// the screen is cohesive AND every view stays bookmarkable / reloadable /
// shareable. Because selection is just query params on one route, the whole
// shell (sidebar + workspace) never unmounts — it just re-renders. That's
// even simpler than Next nested layouts and gives the same "app, not pages"
// feel.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import BriefingBar from "@/components/BriefingBar";
import Sidebar from "@/components/Sidebar";
import Workspace from "@/components/Workspace";

export default function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const a = params.get("a");
  const b = params.get("b");

  // "armed" = user explicitly turned compare on while only one chart is open
  // (so the next plain click adds a 2nd). But the toggle the user SEES should
  // reflect the real state: if two charts are open you ARE comparing,
  // regardless of how you got there (⌘-click or the toggle). So the displayed
  // state is derived, not a separate flag that can disagree with reality.
  const [armed, setArmed] = useState(false);
  const compareActive = armed || Boolean(b);

  function apply(nextA: string | null, nextB: string | null) {
    const q = new URLSearchParams();
    if (nextA) q.set("a", nextA);
    if (nextB) q.set("b", nextB);
    // replace (not push) so range/asset fiddling doesn't bloat history;
    // scroll:false keeps the viewport steady on update.
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  function onPick(symbol: string, additive: boolean) {
    if (additive && a && symbol !== a) {
      apply(a, symbol); // open/replace the 2nd pane
    } else {
      // new primary; if it equals the current B, drop B (no self-compare)
      apply(symbol, b === symbol ? null : b);
    }
  }

  function onCloseA() {
    // closing A promotes B into A's place if B exists
    apply(b, null);
  }
  function onCloseB() {
    apply(a, null);
  }

  function onToggleCompare() {
    if (compareActive) {
      // Turning compare OFF is a real action: disarm AND collapse back to a
      // single chart (drop B). The toggle now genuinely controls the state.
      setArmed(false);
      if (b) apply(a, null);
    } else {
      // Only one chart open: arm it so the next plain click adds the 2nd.
      setArmed(true);
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        activeA={a}
        activeB={b}
        compare={compareActive}
        onToggleCompare={onToggleCompare}
        onPick={onPick}
      />
      <main className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        <BriefingBar />
        {/* min-h-0 lets the workspace shrink so the briefing bar can take
            its natural height — classic flexbox: a flex child won't shrink
            below content size without min-h-0. */}
        <div className="min-h-0 flex-1">
          <Workspace a={a} b={b} onCloseA={onCloseA} onCloseB={onCloseB} />
        </div>
      </main>
    </div>
  );
}
