"use client";

// The chart area: 0, 1, or 2 panes depending on URL selection. Two selected
// → side-by-side grid; one → full width. Pure presentation; selection logic
// lives in Dashboard.

import ChartPane from "@/components/ChartPane";

export default function Workspace({
  a,
  b,
  onCloseA,
  onCloseB,
}: {
  a: string | null;
  b: string | null;
  onCloseA: () => void;
  onCloseB: () => void;
}) {
  if (!a && !b) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        pick an asset from the left · ⌘/Ctrl-click or “compare: on” for a 2nd
        chart
      </div>
    );
  }

  const two = Boolean(a && b);
  return (
    <div
      className={`grid h-full gap-3 ${two ? "grid-cols-2" : "grid-cols-1"}`}
    >
      {a && (
        <ChartPane symbol={a} slot="A" onClose={onCloseA} />
      )}
      {b && (
        <ChartPane symbol={b} slot="B" onClose={onCloseB} />
      )}
    </div>
  );
}
