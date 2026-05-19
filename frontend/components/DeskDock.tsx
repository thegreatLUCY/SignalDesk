"use client";

// The bottom counterpart to BriefingBar. Symmetry is the design idea:
//   • BriefingBar (top)  = what the desk tells YOU  (Tier-1/2, read)
//   • DeskDock   (bottom)= what YOU tell the desk    (journal + notes, write)
// Same collapsible visual language, no new route — the "one screen" rule
// holds and the layout reads as a conversation.
//
// State pattern matches the rest of the app: mutate, then refetch the list
// (not optimistic). Simple, always consistent, good enough at this scale.

import { useEffect, useState } from "react";

import {
  addJournal,
  addNote,
  deleteJournal,
  deleteNote,
  listJournal,
  listNotes,
  patchJournal,
  patchNote,
  type JournalEntry,
  type Note,
} from "@/lib/api";

type Tab = "journal" | "notes";

const KINDS = ["real", "paper", "observation"] as const;

function KindBadge({ kind }: { kind: string }) {
  const cls =
    kind === "real"
      ? "bg-emerald-600/20 text-emerald-400"
      : kind === "paper"
        ? "bg-sky-600/20 text-sky-400"
        : "bg-neutral-700/40 text-neutral-400";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
      title={
        kind === "real"
          ? "Real money"
          : kind === "paper"
            ? "Paper trade (simulated)"
            : "Observation — no position, just a thesis to check later"
      }
    >
      {kind}
    </span>
  );
}

function PLChip({ abs, pct }: { abs: number | null; pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        up ? "bg-emerald-600/20 text-emerald-400" : "bg-red-600/20 text-red-400"
      }`}
      title="Computed from entry/exit/size — not typed in"
    >
      {up ? "+" : ""}
      {pct.toFixed(2)}%
      {abs !== null ? ` · ${up ? "+" : ""}${abs.toFixed(2)}` : ""}
    </span>
  );
}

function fieldNum(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ── Journal ────────────────────────────────────────────────────────────────

function JournalComposer({
  activeSymbol,
  onAdd,
}: {
  activeSymbol: string | null;
  onAdd: () => void;
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("observation");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState("");
  const [size, setSize] = useState("");
  const [thesis, setThesis] = useState("");
  const [busy, setBusy] = useState(false);

  // Prefill the symbol from whatever chart is open — keeps the journal tied
  // to what you're actually looking at (cohesion over re-typing).
  useEffect(() => {
    if (activeSymbol) setSymbol(activeSymbol);
  }, [activeSymbol]);

  const isTrade = kind !== "observation";

  async function submit() {
    if (!thesis.trim()) return;
    setBusy(true);
    try {
      await addJournal({
        kind,
        symbol: symbol.trim().toUpperCase() || null,
        side: isTrade ? side : null,
        entry: isTrade ? fieldNum(entry) : null,
        size: isTrade ? fieldNum(size) : null,
        thesis: thesis.trim(),
        status: "open",
      });
      setThesis("");
      setEntry("");
      setSize("");
      onAdd();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded px-2 py-0.5 text-[11px] capitalize ${
              kind === k
                ? "bg-neutral-200 text-neutral-900"
                : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            {k}
          </button>
        ))}
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="symbol"
          className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs uppercase text-neutral-200 placeholder:text-neutral-600 placeholder:normal-case focus:border-neutral-500 focus:outline-none"
        />
        {isTrade && (
          <>
            <div className="flex overflow-hidden rounded-md border border-neutral-700">
              {(["long", "short"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`px-2 py-1 text-[11px] capitalize ${
                    side === s
                      ? s === "long"
                        ? "bg-emerald-600/30 text-emerald-300"
                        : "bg-red-600/30 text-red-300"
                      : "text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="entry"
              inputMode="decimal"
              className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="size"
              inputMode="decimal"
              className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          </>
        )}
      </div>
      <div className="flex gap-2">
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          placeholder={
            isTrade
              ? "Thesis — why are you taking this trade?"
              : "What are you watching, and what would confirm/invalidate it?"
          }
          rows={2}
          className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy || !thesis.trim()}
          className="shrink-0 self-stretch rounded-md border border-neutral-700 px-4 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          {busy ? "…" : "Log"}
        </button>
      </div>
    </div>
  );
}

function JournalCard({
  e,
  onChange,
}: {
  e: JournalEntry;
  onChange: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [exit, setExit] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  async function closeOut() {
    setBusy(true);
    try {
      await patchJournal(e.id, {
        status: "closed",
        exit: fieldNum(exit),
        outcome: outcome.trim() || null,
      });
      setClosing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    await deleteJournal(e.id);
    onChange();
  }

  const open = e.status === "open";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <KindBadge kind={e.kind} />
        {e.symbol && (
          <span className="text-sm font-semibold text-neutral-100">
            {e.symbol}
          </span>
        )}
        {e.side && (
          <span
            className={`text-[11px] uppercase ${
              e.side === "long" ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {e.side}
          </span>
        )}
        {e.entry !== null && (
          <span className="text-[11px] tabular-nums text-neutral-500">
            @ {e.entry}
            {e.size ? ` × ${e.size}` : ""}
            {e.exit !== null ? ` → ${e.exit}` : ""}
          </span>
        )}
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
            open
              ? "bg-amber-600/20 text-amber-400"
              : "bg-neutral-700/40 text-neutral-400"
          }`}
        >
          {e.status}
        </span>
        <PLChip abs={e.pl_abs} pct={e.pl_pct} />
        <span className="ml-auto text-[10px] text-neutral-600">
          {e.opened_at}
          {e.closed_at ? ` → ${e.closed_at}` : ""}
        </span>
        <button
          onClick={remove}
          title="Delete entry"
          className="text-neutral-600 hover:text-red-400"
        >
          ×
        </button>
      </div>

      {e.thesis && (
        <p className="text-sm leading-relaxed text-neutral-300">
          <span className="text-neutral-600">thesis · </span>
          {e.thesis}
        </p>
      )}
      {e.outcome && (
        <p className="mt-1 text-sm leading-relaxed text-neutral-400">
          <span className="text-neutral-600">lesson · </span>
          {e.outcome}
        </p>
      )}

      {open && e.kind !== "observation" && !closing && (
        <button
          onClick={() => setClosing(true)}
          className="mt-2 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
        >
          Close out
        </button>
      )}
      {open && e.kind === "observation" && !closing && (
        <button
          onClick={() => setClosing(true)}
          className="mt-2 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
        >
          Resolve
        </button>
      )}

      {closing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {e.kind !== "observation" && (
            <input
              value={exit}
              onChange={(ev) => setExit(ev.target.value)}
              placeholder="exit price"
              inputMode="decimal"
              className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          )}
          <input
            value={outcome}
            onChange={(ev) => setOutcome(ev.target.value)}
            placeholder="What happened? What did you learn?"
            className="min-w-[12rem] flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={closeOut}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            {busy ? "…" : "Save"}
          </button>
          <button
            onClick={() => setClosing(false)}
            className="text-[11px] text-neutral-600 hover:text-neutral-400"
          >
            cancel
          </button>
        </div>
      )}
    </div>
  );
}

function JournalPanel({ activeSymbol }: { activeSymbol: string | null }) {
  const [rows, setRows] = useState<JournalEntry[]>([]);
  const refresh = () => listJournal().then(setRows).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-2">
      <JournalComposer activeSymbol={activeSymbol} onAdd={refresh} />
      {rows.length === 0 ? (
        <p className="px-1 py-4 text-center text-xs text-neutral-600">
          No entries yet. Log a thesis above — observations cost nothing and
          compound into pattern recognition.
        </p>
      ) : (
        rows.map((e) => <JournalCard key={e.id} e={e} onChange={refresh} />)
      )}
    </div>
  );
}

// ── Notes ──────────────────────────────────────────────────────────────────

function NotesPanel({ activeSymbol }: { activeSymbol: string | null }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function refresh(keep?: number) {
    const ns = await listNotes();
    setNotes(ns);
    const pick = ns.find((n) => n.id === (keep ?? selId)) ?? ns[0] ?? null;
    setSelId(pick?.id ?? null);
    setTitle(pick?.title ?? "");
    setBody(pick?.body ?? "");
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(n: Note) {
    setSelId(n.id);
    setTitle(n.title ?? "");
    setBody(n.body ?? "");
  }

  async function create() {
    const n = await addNote({
      title: "Untitled",
      body: "",
      symbol: activeSymbol ?? null,
    });
    await refresh(n.id);
  }

  // Save on blur — simple and reliable; no debounce machinery needed for a
  // single-user local tool.
  async function save() {
    if (selId === null) return;
    await patchNote(selId, { title, body });
    refresh(selId);
  }

  const sel = notes.find((n) => n.id === selId) ?? null;

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="w-52 shrink-0 space-y-1 overflow-y-auto border-r border-neutral-800 pr-2">
        <button
          onClick={create}
          className="mb-1 w-full rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
        >
          + New note
        </button>
        {notes.map((n) => (
          <button
            key={n.id}
            onClick={() => select(n)}
            className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-xs ${
              n.id === selId
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            {n.pinned && <span className="text-amber-400">★ </span>}
            {n.title || "Untitled"}
            {n.symbol && (
              <span className="ml-1 text-[10px] text-neutral-600">
                {n.symbol}
              </span>
            )}
          </button>
        ))}
        {notes.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-neutral-600">
            No notes yet.
          </p>
        )}
      </div>

      {sel ? (
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={save}
              placeholder="Title"
              className="flex-1 rounded-md border border-neutral-800 bg-transparent px-2 py-1 text-sm font-semibold text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
            <button
              onClick={async () => {
                await patchNote(sel.id, { pinned: !sel.pinned });
                refresh(sel.id);
              }}
              title={sel.pinned ? "Unpin" : "Pin to top"}
              className={`rounded-md border border-neutral-700 px-2 py-1 text-[11px] ${
                sel.pinned
                  ? "text-amber-400"
                  : "text-neutral-500 hover:bg-neutral-800"
              }`}
            >
              ★
            </button>
            <button
              onClick={async () => {
                await deleteNote(sel.id);
                refresh();
              }}
              title="Delete note"
              className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
            >
              Delete
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            placeholder="Write freely — research, a plan, a rule you keep breaking. Saved when you click away."
            className="flex-1 resize-none rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm leading-relaxed text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
          <p className="text-[10px] text-neutral-600">
            saved on blur · last edited{" "}
            {sel.updated_at
              ? new Date(sel.updated_at).toLocaleString()
              : "—"}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-neutral-600">
          Select or create a note.
        </div>
      )}
    </div>
  );
}

// ── Dock shell ─────────────────────────────────────────────────────────────

// `open` is CONTROLLED by Dashboard now: it owns the vertical split (an
// open dock becomes a flex-1 region; closed = just this header). That's
// what makes the panel scroll INSIDE its allotted space instead of being
// pushed off-screen and clipped (the old max-h-[46vh] bug).
export default function DeskDock({
  activeSymbol,
  open,
  onToggle,
}: {
  activeSymbol: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<Tab>("journal");

  return (
    <div
      className={`${
        open ? "flex min-h-0 flex-1 flex-col" : "shrink-0"
      } rounded-xl border border-neutral-800 bg-neutral-900/40`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold">Desk</span>
          <span className="text-xs text-neutral-500">
            journal &amp; notes
          </span>
        </button>
        {open && (
          <div className="flex overflow-hidden rounded-md border border-neutral-700">
            {(["journal", "notes"] as const).map((t) => (
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
      </div>

      {open && (
        // flex-1 min-h-0 = take exactly the remaining height the dock
        // region was given, and scroll WITHIN it. Journal scrolls its list;
        // Notes manages its own internal panes (h-full), so no outer scroll.
        <div className="min-h-0 flex-1 border-t border-neutral-800">
          {tab === "journal" ? (
            <div className="h-full overflow-y-auto px-4 py-3">
              <JournalPanel activeSymbol={activeSymbol} />
            </div>
          ) : (
            <div className="h-full min-h-0 px-4 py-3">
              <NotesPanel activeSymbol={activeSymbol} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
