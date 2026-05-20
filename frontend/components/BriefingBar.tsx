"use client";

// The Tier-1 briefing surfaced as a collapsible bar AND a mini-archive:
// a date browser to read past briefings, with Tier-2 annotations rendered
// BENEATH the draft (never merged into it) — the git-like audit made visible.
//
// Provenance is color-coded everywhere (emerald = AI, amber = templated,
// per-annotation badges too) so you always know who wrote what.

import { type ReactNode, useEffect, useState } from "react";

import BriefingCalendar from "@/components/BriefingCalendar";
import MacroPanel from "@/components/MacroPanel";
import NewsPanel from "@/components/NewsPanel";
import {
  addAnnotation,
  getBriefingByDate,
  getFng,
  listBriefings,
  runBriefing,
  type Annotation,
  type BriefingDetail,
  type BriefingListItem,
  type FngPoint,
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

// Per-agent Tier-2 chip for the collapsed header. Color encodes WHO
// reviewed: codex=violet, claude=orange, manual=sky — so at a glance you
// know the briefing got a strong-model pass and by which agent.
function agentCls(provider: string): string {
  switch (provider) {
    case "codex":
      return "bg-violet-600/20 text-violet-300";
    case "claude":
      return "bg-orange-600/20 text-orange-300";
    case "manual":
      return "bg-sky-600/20 text-sky-300";
    default:
      return "bg-neutral-700/40 text-neutral-300";
  }
}

function AgentChip({
  provider,
  count,
}: {
  provider: string;
  count: number;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${agentCls(
        provider,
      )}`}
      title={`Tier-2 review by ${provider}${
        count > 1 ? ` (${count} notes)` : ""
      }`}
    >
      tier 2 · {provider}
      {count > 1 ? ` ·${count}` : ""}
    </span>
  );
}

// Distinct annotation authors in first-seen order, with counts — drives
// the header chips (one per agent, not a generic "N notes").
function annotationAgents(
  anns: Annotation[],
): { provider: string; count: number }[] {
  const order: string[] = [];
  const counts: Record<string, number> = {};
  for (const a of anns) {
    const p = a.provenance.provider || "unknown";
    if (!(p in counts)) order.push(p);
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return order.map((p) => ({ provider: p, count: counts[p] }));
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

// ── Briefing card (Pencil restyle, style-only) ─────────────────────────────
// Everything below derives from structured fields already in
// b.provenance (risk_stance, vix_regime, snapshot[]). No string parsing,
// no fabricated values — same no-garbage rule the rest of the app follows.

function MetricTile({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: ReactNode; // ReactNode (not string) so the F&G tile can inline a
                    // qualifier next to its number without breaking the
                    // shared 2-line tile rhythm.
  color: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2"
      title={title}
    >
      <div className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

function BriefingActionLine({ a }: { a: Annotation }) {
  // Tier-2 = cyan TIER-2; tier-1/manual = amber NOTE. We never invent
  // an ACTION category we don't have in the data. The body uses the same
  // markdown renderer the briefing draft uses, so **bold** / bullets /
  // headings written by the strong model render properly inside the card.
  const isT2 = a.provenance.tier === 2;
  const label = isT2 ? "TIER-2" : "NOTE";
  const cls = isT2
    ? "border-cyan-700/50 bg-cyan-600/15 text-cyan-300"
    : "border-amber-700/50 bg-amber-600/15 text-amber-300";
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${cls}`}
        title={`${a.provenance.provider} · ${a.provenance.model}`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <Markdown text={a.body} />
      </div>
    </div>
  );
}

function BriefingCard({
  b,
  onRegenerate,
  busy,
}: {
  b: BriefingDetail;
  onRegenerate: () => void;
  busy: boolean;
}) {
  // Crypto Fear & Greed — fourth metric tile. Real data from /fng
  // (alternative.me). Display-only; deliberately not part of the
  // deterministic risk computation (sentiment ≠ stance).
  const [fng, setFng] = useState<FngPoint | null>(null);
  useEffect(() => {
    getFng()
      .then((d) => setFng(d ?? null))
      .catch(() => setFng(null));
  }, []);
  const fngColor = !fng
    ? "text-neutral-500"
    : fng.value < 25
      ? "text-red-400"
      : fng.value < 45
        ? "text-orange-400"
        : fng.value < 55
          ? "text-amber-400"
          : fng.value < 75
            ? "text-lime-400"
            : "text-emerald-400";

  // Breadth: how much of the watchlist is in an uptrend right now. Uses the
  // per-asset snapshot the briefing already persisted (no extra fetch).
  const snap =
    (b.provenance.snapshot as
      | Array<{ symbol: string; pct: number; trend: string | null }>
      | undefined) ?? [];
  // No snapshot → don't fabricate a breadth %. Older briefings predate this
  // field, and showing "0%, DOWN, narrow leadership" would be a lie.
  const hasBreadth = snap.length > 0;
  const upCount = snap.filter((s) => s.trend === "up").length;
  const breadthPct = hasBreadth
    ? Math.round((upCount / snap.length) * 100)
    : null;
  const leadership =
    breadthPct === null
      ? "—"
      : breadthPct >= 60
        ? "broad leadership"
        : breadthPct <= 40
          ? "narrow leadership"
          : "mixed leadership";
  const stance = b.provenance.risk_stance ?? "neutral";
  const tone =
    stance === "risk-on"
      ? "Risk-on"
      : stance === "risk-off"
        ? "Risk-off"
        : "Balanced";
  const trendLabel =
    breadthPct === null
      ? "—"
      : breadthPct >= 60
        ? "UP"
        : breadthPct <= 40
          ? "DOWN"
          : "MIXED";
  const trendColor =
    breadthPct === null
      ? "text-neutral-500"
      : breadthPct >= 60
        ? "text-emerald-400"
        : breadthPct <= 40
          ? "text-red-400"
          : "text-amber-400";
  const breadthColor = trendColor;
  const vix = (b.provenance.vix_regime ?? "—").toUpperCase();
  // Both extremes are warnings, not "good vs bad". LOW = complacent /
  // mean-reversion risk; HIGH/ELEVATED = realised fear. Matches the ref's
  // VOL LOW shown in red. NORMAL sits in the middle (amber).
  const volColor =
    vix === "—"
      ? "text-neutral-500"
      : vix === "NORMAL"
        ? "text-amber-400"
        : "text-red-400"; // LOW, HIGH, ELEVATED → red

  let updated = "—";
  try {
    updated = new Date(b.created_at).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    /* keep the em-dash */
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
          Daily Briefing
        </span>
        <button
          onClick={onRegenerate}
          disabled={busy}
          title="Regenerate today's briefing"
          aria-label="Regenerate briefing"
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M11.5 2L14 4.5L4.5 14L1.5 14.5L2 11.5L11.5 2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="mb-3 text-base font-semibold text-neutral-100">
        Risk tone:{" "}
        <span className="text-neutral-300">
          {tone}, {leadership}
        </span>
      </div>

      {/* 2 columns on narrow widths → 4 across once the dock is wide enough.
          The F&G tile fits as a peer of Trend / Breadth / Vol — same chrome,
          same rhythm — with its alternative.me classification inlined as a
          smaller qualifier next to the number. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Trend" value={trendLabel} color={trendColor} />
        <MetricTile
          label="Breadth"
          value={breadthPct === null ? "—" : `${breadthPct}%`}
          color={breadthColor}
        />
        <MetricTile label="Vol" value={vix} color={volColor} />
        <MetricTile
          label="Crypto F&G"
          color={fngColor}
          title={
            fng
              ? `Crypto Fear & Greed · alternative.me · ${fng.label}`
              : "Crypto Fear & Greed — alternative.me (loading or offline)"
          }
          value={
            fng ? (
              <>
                {fng.value}
                <span className="ml-1 align-middle text-[11px] font-medium opacity-80">
                  {fng.label}
                </span>
              </>
            ) : (
              "—"
            )
          }
        />
      </div>

      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-neutral-600">
        Tier-2 reviews{" "}
        <span className="normal-case text-neutral-700">
          — layered on top, the draft below is never changed
        </span>
      </div>
      {b.annotations.length === 0 ? (
        <p className="text-xs text-neutral-600">
          No reviews yet. The strong model (via MCP) — or you — can layer
          corrections / context here.
        </p>
      ) : (
        <div className="space-y-1.5">
          {b.annotations.map((a) => (
            <BriefingActionLine key={a.id} a={a} />
          ))}
        </div>
      )}

      <div className="mt-3 text-[10px] uppercase tracking-widest text-neutral-700">
        updated {updated} ET
      </div>
    </div>
  );
}

export default function BriefingBar() {
  const [list, setList] = useState<BriefingListItem[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [b, setB] = useState<BriefingDetail | null>(null);
  const [open, setOpen] = useState(false);
  // 3-tab top dock, mirroring DeskDock's pattern (Journal|Notes ↔ desk speaks
  // here, you speak there). Briefing stays primary; macro/news are context.
  const [tab, setTab] = useState<"briefing" | "macro" | "news">("briefing");
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

  async function goToday() {
    // force=false → idempotent: returns today's briefing if it exists
    // (cheap, no LLM), generates it if it doesn't. Either way the backend
    // decides "today" in market tz, then we select exactly that date.
    setBusy(true);
    setErr(null);
    try {
      const b = await runBriefing(false);
      await refreshList(b.date);
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
      {/* The ENTIRE row toggles (including empty space) — not just the
          label. role/tabIndex/onKeyDown keep it keyboard-accessible since
          it's a div, not a <button> (a button can't legally wrap the
          calendar/regenerate controls). The controls cluster below stops
          propagation so clicking them never toggles the dock. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2 text-left">
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
              {annotationAgents(b.annotations).map((a) => (
                <AgentChip
                  key={a.provider}
                  provider={a.provider}
                  count={a.count}
                />
              ))}
            </>
          ) : (
            <span className="text-xs text-neutral-500">
              {err ? "unavailable" : "no briefing yet"}
            </span>
          )}
        </div>
        {/* stopPropagation so the calendar + regenerate don't toggle the
            dock (the row's onClick would otherwise fire on bubble). */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-2"
        >
          {/* Tabs appear only when open — same as DeskDock, keeps the
              collapsed bar minimal. */}
          {open && (
            <div className="flex overflow-hidden rounded-md border border-neutral-700">
              {(["briefing", "macro", "news"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-[11px] capitalize ${
                    tab === t
                      ? "bg-neutral-200 text-neutral-900"
                      : "text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {/* Calendar + regenerate are briefing-specific. */}
          {open && tab === "briefing" && list.length > 0 && (
            <BriefingCalendar
              list={list}
              selected={date}
              onPick={(d) => pick(d)}
              onToday={goToday}
            />
          )}
          {/* Header regenerate appears on Macro/News tabs only — on the
              Briefing tab the card's pencil owns this action, so we don't
              show two regenerate controls at once. */}
          {open && tab !== "briefing" && (
            <button
              onClick={regenerate}
              disabled={busy}
              className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              title="Regenerate today's briefing (uses your LLM key if set)"
            >
              {busy ? "working…" : "↻ regenerate"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="max-h-[44vh] overflow-y-auto border-t border-neutral-800 px-5 py-3">
          {tab === "macro" && <MacroPanel />}
          {tab === "news" && <NewsPanel />}
          {tab === "briefing" && (
            <>
          {err && <p className="mb-2 text-sm text-red-400">{err}</p>}
          {b ? (
            <>
              {/* Restyled briefing card (Pencil ref) on top — the card is
                  the summary, the composer sits right under it (so adding
                  a Tier-2 note doesn't require scrolling past the whole
                  draft), and the full markdown draft is the detail view
                  below. */}
              <BriefingCard b={b} onRegenerate={regenerate} busy={busy} />

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

              <div className="mt-4 border-t border-neutral-800 pt-3">
                <Markdown text={b.body} />
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
