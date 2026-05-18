"use client";

// The Tier-1 briefing surfaced as a collapsible bar AND a mini-archive:
// a date browser to read past briefings, with Tier-2 annotations rendered
// BENEATH the draft (never merged into it) — the git-like audit made visible.
//
// Provenance is color-coded everywhere (emerald = AI, amber = templated,
// per-annotation badges too) so you always know who wrote what.

import { useEffect, useState } from "react";

import {
  addAnnotation,
  getBriefingByDate,
  listBriefings,
  runBriefing,
  type Annotation,
  type BriefingDetail,
  type BriefingListItem,
} from "@/lib/api";

function RiskChip({ stance }: { stance?: string }) {
  if (!stance) return null;
  const cls =
    stance === "risk-on"
      ? "bg-emerald-600/20 text-emerald-400"
      : stance === "risk-off"
        ? "bg-red-600/20 text-red-400"
        : "bg-amber-600/20 text-amber-400";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
      title="Deterministic market risk call (computed, not the AI's opinion)"
    >
      {stance}
    </span>
  );
}

function ProvBadge({
  provider,
  model,
  tier,
}: {
  provider: string;
  model: string;
  tier: number;
}) {
  const isAI = provider !== "template" && provider !== "manual";
  const cls =
    provider === "template"
      ? "bg-amber-600/20 text-amber-400"
      : provider === "manual"
        ? "bg-sky-600/20 text-sky-400"
        : "bg-emerald-600/20 text-emerald-400";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
      title={
        isAI
          ? `${provider} · ${model}`
          : provider === "manual"
            ? "Manual Tier-2 note"
            : "Deterministic templated fallback"
      }
    >
      tier {tier} · {provider === "template" ? "templated" : provider}
    </span>
  );
}

function Markdown({ text }: { text: string }) {
  const bold = (s: string) =>
    s.split(/\*\*(.+?)\*\*/g).map((p, j) =>
      j % 2 === 1 ? (
        <strong key={j} className="text-neutral-100">
          {p}
        </strong>
      ) : (
        <span key={j}>{p}</span>
      ),
    );
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-neutral-300">
      {text.split("\n").map((ln, i) => {
        if (ln.startsWith("### "))
          return (
            <h3 key={i} className="pt-2 text-sm font-semibold text-neutral-100">
              {ln.slice(4)}
            </h3>
          );
        if (ln.startsWith("# "))
          return (
            <h2 key={i} className="text-base font-semibold text-white">
              {ln.slice(2)}
            </h2>
          );
        if (ln.startsWith("- "))
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-neutral-600">•</span>
              <span>{bold(ln.slice(2))}</span>
            </div>
          );
        if (ln.startsWith("---")) return <hr key={i} className="border-neutral-800" />;
        if (ln.startsWith("_") && ln.endsWith("_") && ln.length > 1)
          return (
            <p key={i} className="text-xs italic text-neutral-500">
              {ln.slice(1, -1)}
            </p>
          );
        if (!ln.trim()) return null;
        return <p key={i}>{bold(ln)}</p>;
      })}
    </div>
  );
}

function AnnotationCard({ a }: { a: Annotation }) {
  return (
    <div className="rounded-lg border border-sky-900/50 bg-sky-950/20 p-3">
      <div className="mb-1 flex items-center gap-2">
        <ProvBadge
          provider={a.provenance.provider}
          model={a.provenance.model}
          tier={a.provenance.tier}
        />
        <span className="text-[10px] text-neutral-600">
          {new Date(a.created_at).toLocaleString()}
        </span>
      </div>
      <Markdown text={a.body} />
    </div>
  );
}

export default function BriefingBar() {
  const [list, setList] = useState<BriefingListItem[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [b, setB] = useState<BriefingDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function refreshList(selected?: string) {
    const rows = await listBriefings();
    setList(rows);
    const d = selected ?? rows[0]?.date ?? null;
    setDate(d);
    if (d) setB(await getBriefingByDate(d));
    else setB(null);
  }

  useEffect(() => {
    refreshList().catch((e) => setErr(String(e)));
  }, []);

  async function pick(d: string) {
    setDate(d);
    setErr(null);
    try {
      setB(await getBriefingByDate(d));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function regenerate() {
    setBusy(true);
    setErr(null);
    try {
      await runBriefing(true);
      await refreshList(); // newest (today) becomes selected
      setOpen(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitNote() {
    if (!note.trim() || !date) return;
    setBusy(true);
    try {
      setB(await addAnnotation(date, note.trim()));
      setNote("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-900/40">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold">Daily Briefing</span>
          {b ? (
            <>
              <RiskChip stance={b.provenance.risk_stance} />
              <ProvBadge
                provider={b.provenance.provider}
                model={b.provenance.model}
                tier={b.provenance.tier}
              />
              {b.annotations.length > 0 && (
                <span className="rounded bg-sky-600/20 px-1.5 py-0.5 text-[10px] text-sky-400">
                  {b.annotations.length} note
                  {b.annotations.length > 1 ? "s" : ""}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-neutral-500">
              {err ? "unavailable" : "no briefing yet"}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {list.length > 0 && (
            <select
              value={date ?? ""}
              onChange={(e) => pick(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300"
              title="Browse past briefings"
            >
              {list.map((it) => (
                <option key={it.date} value={it.date}>
                  {it.date}
                  {it.risk_stance ? ` · ${it.risk_stance}` : ""}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={regenerate}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            title="Regenerate today's briefing (uses your LLM key if set)"
          >
            {busy ? "working…" : "↻ regenerate"}
          </button>
        </div>
      </div>

      {open && (
        <div className="max-h-[44vh] overflow-y-auto border-t border-neutral-800 px-5 py-3">
          {err && <p className="mb-2 text-sm text-red-400">{err}</p>}
          {b ? (
            <>
              <Markdown text={b.body} />

              <div className="mt-4 border-t border-neutral-800 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Tier-2 annotations{" "}
                  <span className="font-normal normal-case text-neutral-600">
                    — layered on top, the draft above is never changed
                  </span>
                </div>
                {b.annotations.length === 0 ? (
                  <p className="text-xs text-neutral-600">
                    No annotations yet. The strong model (via MCP, Phase 8) or
                    you can layer corrections/context here.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {b.annotations.map((a) => (
                      <AnnotationCard key={a.id} a={a} />
                    ))}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitNote()}
                    placeholder="Add a Tier-2 note…"
                    className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                  />
                  <button
                    onClick={submitNote}
                    disabled={busy || !note.trim()}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                  >
                    add note
                  </button>
                </div>
              </div>
            </>
          ) : (
            !err && (
              <p className="text-sm text-neutral-500">
                No briefing yet — the cron runs at 10:30 ET, or hit ↻
                regenerate.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
