"use client";

// Macro tab — deterministic FRED numbers, no AI. Same labeled-pill language
// as the chart metrics so it reads as one product. A null value means FRED
// gave us nothing (or no FRED_API_KEY yet) — we show '—', never a guess.

import { useEffect, useState } from "react";

import { getMacro, type MacroPoint } from "@/lib/api";

function valueColor(series: string, v: number | null): string {
  if (v === null) return "text-neutral-600";
  if (series === "T10Y2Y") return v < 0 ? "text-red-400" : "text-emerald-400";
  return "text-neutral-100";
}

export default function MacroPanel() {
  const [rows, setRows] = useState<MacroPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getMacro().then(setRows).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!rows)
    return <p className="text-sm text-neutral-500">loading macro…</p>;

  const allEmpty = rows.every((r) => r.value === null);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((m) => (
          <div
            key={m.series}
            className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2"
            title={
              m.observed_at
                ? `FRED ${m.series} · as of ${m.observed_at}`
                : `FRED ${m.series}`
            }
          >
            <div className="text-[11px] text-neutral-500">{m.label}</div>
            <div
              className={`text-lg font-semibold tabular-nums ${valueColor(
                m.series,
                m.value,
              )}`}
            >
              {m.value === null ? "—" : `${m.value}${m.unit}`}
              {m.series === "T10Y2Y" && m.value !== null && (
                <span className="ml-1 text-[10px] font-normal text-neutral-500">
                  {m.value < 0 ? "inverted" : "normal"}
                </span>
              )}
            </div>
            {m.observed_at && (
              <div className="text-[10px] text-neutral-600">
                as of {m.observed_at}
              </div>
            )}
          </div>
        ))}
      </div>

      {allEmpty ? (
        <p className="text-xs text-amber-400/80">
          No macro data yet — add a free <code>FRED_API_KEY</code> to{" "}
          <code>.env</code> and restart the backend. Everything else works
          without it; the briefing simply omits macro until then.
        </p>
      ) : (
        <p className="text-[11px] text-neutral-600">
          Source: FRED (St. Louis Fed). Deterministic — these exact numbers
          are also handed to the briefing to narrate, never invented.
        </p>
      )}
    </div>
  );
}
