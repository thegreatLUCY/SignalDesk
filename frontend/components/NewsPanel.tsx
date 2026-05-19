"use client";

// News tab — free RSS headlines + an on-demand DESCRIPTIVE brief. The brief
// is never auto-generated (a GET only returns a cached one); the button is
// the only thing that spends a Groq call — same discipline as the briefing's
// ↻ regenerate. Provenance-badged; deliberately separate from the risk
// stance (news is context to read, not an input to the computed call).

import { useEffect, useState } from "react";

import {
  getNews,
  getNewsBrief,
  makeNewsBrief,
  type NewsBrief,
  type NewsItem,
} from "@/lib/api";

function sourceColor(src: string): string {
  if (src === "CNBC") return "bg-sky-600/20 text-sky-300";
  if (src === "WSJ Markets") return "bg-emerald-600/20 text-emerald-300";
  if (src === "Federal Reserve") return "bg-violet-600/20 text-violet-300";
  return "bg-neutral-700/40 text-neutral-300";
}

function ago(iso: string): string {
  const mins = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

// Minimal renderer: the brief is plain bullets / **bold** prose.
function briefLines(text: string) {
  return text.split("\n").map((ln, i) => {
    const body = ln.replace(/^- /, "");
    const parts = body.split(/\*\*(.+?)\*\*/g).map((p, j) =>
      j % 2 === 1 ? (
        <strong key={j} className="text-neutral-100">
          {p}
        </strong>
      ) : (
        <span key={j}>{p}</span>
      ),
    );
    if (!ln.trim()) return null;
    return ln.startsWith("- ") ? (
      <div key={i} className="flex gap-2 pl-1 text-sm text-neutral-300">
        <span className="text-neutral-600">•</span>
        <span>{parts}</span>
      </div>
    ) : (
      <p key={i} className="text-sm text-neutral-300">
        {parts}
      </p>
    );
  });
}

export default function NewsPanel() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [b, setB] = useState<NewsBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Collapse the brief to a one-line header so the headlines aren't pushed
  // down. Persisted (default false so behaviour is unchanged out of the box).
  const [briefMin, setBriefMin] = useState(false);
  useEffect(() => {
    try {
      setBriefMin(localStorage.getItem("signaldesk:news-brief-min") === "1");
    } catch {
      /* no storage — fine */
    }
  }, []);
  function toggleBriefMin() {
    setBriefMin((v) => {
      const next = !v;
      try {
        localStorage.setItem("signaldesk:news-brief-min", next ? "1" : "0");
      } catch {
        /* no-op */
      }
      return next;
    });
  }

  useEffect(() => {
    getNews().then(setItems).catch((e) => setErr(String(e)));
    getNewsBrief().then(setB).catch(() => {});
  }, []);

  async function summarise() {
    setBusy(true);
    setErr(null);
    try {
      setB(await makeNewsBrief());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const isAI = b && b.provider !== "template" && b.provider !== "none";

  return (
    <div className="space-y-3">
      {/* Descriptive brief */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
        <div className={`flex items-center gap-2 ${briefMin ? "" : "mb-2"}`}>
          <button
            onClick={toggleBriefMin}
            title={briefMin ? "Expand brief" : "Minimize brief"}
            aria-label={briefMin ? "Expand brief" : "Minimize brief"}
            className="text-neutral-500 hover:text-neutral-200"
          >
            {briefMin ? "▸" : "▾"}
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            News brief
          </span>
          {b && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                isAI
                  ? "bg-emerald-600/20 text-emerald-400"
                  : "bg-amber-600/20 text-amber-400"
              }`}
              title={`${b.provider} · ${b.model}`}
            >
              {isAI ? `${b.provider}` : "templated"}
            </span>
          )}
          {!briefMin && (
            <span className="text-[10px] normal-case text-neutral-600">
              descriptive only — not a market call, not part of the risk
              stance
            </span>
          )}
          <button
            onClick={summarise}
            disabled={busy}
            className="ml-auto rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            title="Summarise the current headlines (spends one LLM call)"
          >
            {busy ? "working…" : b ? "↻ re-summarise" : "summarise"}
          </button>
        </div>
        {!briefMin &&
          (b ? (
            <div className="space-y-1">{briefLines(b.body)}</div>
          ) : (
            <p className="text-xs text-neutral-600">
              No brief yet — hit “summarise” to get a neutral, descriptive
              digest of the headlines below.
            </p>
          ))}
      </div>

      {/* Headlines */}
      {err && <p className="text-sm text-red-400">{err}</p>}
      {!items ? (
        <p className="text-sm text-neutral-500">loading headlines…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-600">No headlines fetched yet.</p>
      ) : (
        <div className="space-y-1">
          {items.map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-900"
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceColor(
                  n.source,
                )}`}
              >
                {n.source}
              </span>
              <span className="flex-1 text-sm text-neutral-200">
                {n.title}
              </span>
              <span className="shrink-0 text-[10px] text-neutral-600">
                {ago(n.saved_at)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
