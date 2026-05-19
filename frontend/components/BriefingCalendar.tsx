"use client";

// Replaces the date <select> with a real month calendar — "view any day"
// at a glance instead of scrolling a flat list. Days that HAVE a briefing
// are lit and carry a risk-stance dot (the same emerald/amber/red language
// used everywhere); today gets a ring; the selected day is filled.
//
// It's a controlled popover: the parent owns the selected date and the
// briefing list; this component is pure presentation + a date callback.

import { useEffect, useMemo, useRef, useState } from "react";

import type { BriefingListItem } from "@/lib/api";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function stanceDot(stance: string | null): string {
  return stance === "risk-on"
    ? "bg-emerald-400"
    : stance === "risk-off"
      ? "bg-red-400"
      : "bg-amber-400";
}

// Local 'YYYY-MM-DD' — never toISOString() (that's UTC and would shift the
// day across midnight, the exact class of bug we just fixed on the backend).
function ymd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function BriefingCalendar({
  list,
  selected,
  onPick,
  onToday,
}: {
  list: BriefingListItem[];
  selected: string | null;
  onPick: (date: string) => void;
  // Jump to today: the parent generates today's briefing if it doesn't
  // exist yet (idempotent + cheap if it does), then selects it. Done in the
  // parent because "today" must be the backend's market date, not the
  // browser's local date (the split-brain lesson, client-side).
  onToday: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // date → item, for O(1) "does this day have a briefing?" lookups.
  const byDate = useMemo(() => {
    const m = new Map<string, BriefingListItem>();
    for (const it of list) m.set(it.date, it);
    return m;
  }, [list]);

  // The month the grid is showing. Defaults to the selected day's month so
  // opening the calendar lands you where you already are.
  const seed = selected ? new Date(`${selected}T00:00:00`) : new Date();
  const [view, setView] = useState({
    y: seed.getFullYear(),
    m: seed.getMonth(),
  });
  useEffect(() => {
    if (selected) {
      const d = new Date(`${selected}T00:00:00`);
      setView({ y: d.getFullYear(), m: d.getMonth() });
    }
  }, [selected]);

  // Close on outside-click and Esc — table stakes for a popover.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const today = ymd(new Date());
  const sel = selected ? byDate.get(selected) : undefined;

  // Build the 6-row grid: leading blanks for the 1st's weekday, then days.
  const first = new Date(view.y, view.m, 1);
  const lead = first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function shift(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
        title="Browse briefings by date"
      >
        <span className="tabular-nums">{selected ?? "no date"}</span>
        {sel?.risk_stance && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${stanceDot(
              sel.risk_stance,
            )}`}
          />
        )}
        <span className="text-neutral-600">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-2xl shadow-black/50">
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={() => shift(-1)}
              className="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="text-xs font-semibold text-neutral-200">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              onClick={() => shift(1)}
              className="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {DOW.map((d, i) => (
              <div
                key={i}
                className="text-center text-[10px] font-medium text-neutral-600"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const date = `${view.y}-${`${view.m + 1}`.padStart(
                2,
                "0",
              )}-${`${day}`.padStart(2, "0")}`;
              const item = byDate.get(date);
              const isSel = date === selected;
              const isToday = date === today;
              const has = Boolean(item);
              return (
                <button
                  key={i}
                  disabled={!has}
                  onClick={() => {
                    onPick(date);
                    setOpen(false);
                  }}
                  title={
                    has
                      ? `${date} · ${item!.risk_stance ?? "—"} · ${
                          item!.provider
                        }`
                      : `${date} — no briefing`
                  }
                  className={`relative flex h-8 flex-col items-center justify-center rounded-md text-xs tabular-nums transition-colors ${
                    isSel
                      ? "bg-neutral-200 font-semibold text-neutral-900"
                      : has
                        ? "text-neutral-200 hover:bg-neutral-800"
                        : "cursor-default text-neutral-700"
                  } ${
                    isToday && !isSel ? "ring-1 ring-inset ring-sky-500/60" : ""
                  }`}
                >
                  {day}
                  {has && !isSel && (
                    <span
                      className={`absolute bottom-1 h-1 w-1 rounded-full ${stanceDot(
                        item!.risk_stance,
                      )}`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => {
              const n = new Date();
              setView({ y: n.getFullYear(), m: n.getMonth() });
              onToday();
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
          >
            Jump to today
          </button>

          <div className="mt-2 flex items-center gap-3 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              on
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              neutral
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              off
            </span>
            <span className="ml-auto flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-sky-500/60" />
              today
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
