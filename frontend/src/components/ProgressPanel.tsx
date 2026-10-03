import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  History,
  Loader2,
  Minus,
  Trash2,
  Upload,
  X,
} from "lucide-react"

type Session = {
  id: number
  created_at?: string
  filename?: string
  persona?: string
  has_jd?: number
  answers?: number
  avg_score?: number
}

type Competency = {
  competency: string
  attempts: number
  avg_score: number
  best: number
  worst: number
  trend: number
}

type Behaviour = {
  sessions: number
  answered: number
  corrected: number
  retried: number
  improved: number
}

type ChatSession = {
  session: number
  turns: number
  started_at: string
  preview: string
}

type HistoryData = {
  sessions: Session[]
  competencies: Competency[]
  weak: string[]
  behaviour: Behaviour
  chat?: { turns: number; sessions: ChatSession[] }
  db_path: string
}

const EMPTY_BEHAVIOUR: Behaviour = {
  sessions: 0,
  answered: 0,
  corrected: 0,
  retried: 0,
  improved: 0,
}

/**
 * Local practice history panel.
 *
 * Positioned cleanly under the navbar (top-16 right-4), properly constrained so
 * it never overflows the viewport, with a scrollable content area and pinned
 * header + action footer.
 */
export default function ProgressPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<HistoryData | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HistoryData | null) => {
        if (!cancelled && d) setData(d)
      })
      .catch(() => {
        /* history is optional — never block practice */
      })
    return () => {
      cancelled = true
    }
  }, [open, reloadKey])

  const exportHistory = async () => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch("/api/history/export")
      if (!res.ok) throw new Error("export failed")
      const blob = await res.json()
      const total =
        (blob.sessions?.length ?? 0) +
        (blob.answers?.length ?? 0) +
        (blob.chat_turns?.length ?? 0)
      if (!total) {
        setNote("Nothing recorded yet, so there is nothing to export")
        return
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" })
      )
      const a = document.createElement("a")
      a.href = url
      a.download = "aria-history.json"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setNote(
        `Exported ${blob.sessions?.length ?? 0} practice session(s), ` +
          `${blob.answers?.length ?? 0} answer(s), ${blob.chat_turns?.length ?? 0} chat turn(s)`
      )
    } catch {
      setNote("Could not export history")
    } finally {
      setBusy(false)
    }
  }

  const importHistory = async (file: File) => {
    setBusy(true)
    setNote(null)
    try {
      const parsed = JSON.parse(await file.text())
      const res = await fetch("/api/history/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      })
      const out = await res.json()
      setNote(
        res.ok
          ? `Imported ${out.sessions} session(s), ${out.answers} answer(s)`
          : out.detail || "Import failed"
      )
      setReloadKey((k) => k + 1)
    } catch {
      setNote("That file was not a valid history export")
    } finally {
      setBusy(false)
    }
  }

  const clearHistory = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 4000)
      return
    }
    setBusy(true)
    setConfirmClear(false)
    try {
      await fetch("/api/history/clear", { method: "POST" })
      setNote("Local history deleted")
      setReloadKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  const behaviour = data?.behaviour ?? EMPTY_BEHAVIOUR
  const competencies = data?.competencies ?? []
  const sessions = data?.sessions ?? []
  const chatTurns = data?.chat?.turns ?? 0
  const chatSessions = data?.chat?.sessions ?? []
  const empty =
    behaviour.answered === 0 && chatTurns === 0 && sessions.length === 0

  const panel = open
    ? createPortal(
        <div className="fixed inset-0 z-50">
          {/* Backdrop to capture outside clicks */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => setOpen(false)}
          />

          {/* Panel popover anchored right beneath the navbar at top-16 right-4 */}
          <div
            className="fixed right-3 sm:right-6 top-14 sm:top-16 z-50 flex flex-col w-[23rem] sm:w-[25rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/15 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{ maxHeight: "calc(100vh - 4.5rem)" }}
          >
            {/* ── Header ── */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-iris-500/15 text-iris-300 border border-iris-500/20">
                  <BarChart3 className="size-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-white uppercase">
                    Your Progress
                  </h3>
                  <p className="text-[10px] text-white/40">On-device practice history</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex size-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* ── Scrollable Body ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-4 text-xs">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                <p className="text-[10px] leading-relaxed text-white/50">
                  Stored only on this device (<span className="text-white/70 font-mono text-[9px]">{data?.db_path ?? "aria_history.db"}</span>). Nothing is uploaded.
                </p>
              </div>

              {empty && (
                <div className="rounded-xl border border-dashed border-white/10 p-3">
                  <p className="text-[11px] text-white/55">
                    Nothing recorded yet.
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5 leading-relaxed">
                    Every chat turn and every scored answer is logged here.
                    Send one message in Free chat, or answer a question in
                    Interview coach, and this fills in automatically.
                  </p>
                </div>
              )}

              {/* Stats 4-column grid */}
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5">
                  Session metrics
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  <Stat label="Answered" value={behaviour.answered} />
                  <Stat label="Corrected" value={behaviour.corrected} />
                  <Stat label="Retried" value={behaviour.retried} />
                  <Stat label="Improved" value={behaviour.improved} />
                </div>
                <p className="mt-1.5 text-[10px] text-white/35 leading-tight">
                  Confidence is measured by behaviour you chose — answered, corrected, retried, improved.
                </p>
              </div>

              {/* Per-competency section */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                    Competencies
                  </p>
                  {competencies.length > 0 && (
                    <span className="text-[10px] text-white/30">{competencies.length} tracked</span>
                  )}
                </div>

                {competencies.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-3 text-center">
                    <p className="text-[11px] text-white/45">
                      No scored answers yet.
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5">
                      Answer a question in Interview coach to start tracking skills.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
                    {competencies.map((c) => (
                      <div
                        key={c.competency}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition"
                      >
                        <TrendIcon trend={c.trend} />
                        <span className="min-w-0 flex-1 truncate text-white/80 font-medium">
                          {c.competency}
                        </span>
                        <span className="shrink-0 text-[10px] text-white/40">
                          {c.attempts}×
                        </span>
                        <span className="w-10 shrink-0 text-right font-mono text-[11px] font-semibold text-white/90">
                          {c.avg_score}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {(data?.weak?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-1.5 text-[10px] text-amber-200/80">
                    <span className="font-semibold text-amber-300">Focus areas: </span>
                    {data?.weak?.join(", ")} — Aria will prioritize these.
                  </div>
                )}
              </section>

              {/* Conversations (free chat) */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                    Conversations
                  </p>
                  <span className="text-[10px] text-white/30">
                    {chatTurns} turn{chatTurns === 1 ? "" : "s"}
                  </span>
                </div>
                {chatSessions.length === 0 ? (
                  <p className="text-[11px] text-white/35 italic">
                    No chats yet — nothing you say is stored on a server.
                  </p>
                ) : (
                  <div className="space-y-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
                    {chatSessions.slice(0, 6).map((c) => (
                      <div
                        key={c.session}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] text-white/60"
                      >
                        <span className="min-w-0 truncate text-white/75">
                          <span className="text-white/35 font-mono text-[10px]">#{c.session} </span>
                          {c.preview || "(empty)"}
                        </span>
                        <span className="shrink-0 text-[10px] text-white/40 font-mono">
                          {c.turns} turn{c.turns === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent Sessions */}
              <section className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                  Recent Sessions
                </p>
                {sessions.length === 0 ? (
                  <p className="text-[11px] text-white/35 italic">No sessions yet.</p>
                ) : (
                  <div className="space-y-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
                    {sessions.slice(0, 5).map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.04]"
                      >
                        <span className="min-w-0 truncate text-white/75 font-medium">
                          {s.filename || "Resume session"}
                          {s.has_jd ? " · +JD" : ""}
                        </span>
                        <span className="shrink-0 text-[10px] text-white/40 font-mono">
                          {s.answers ?? 0} ans · <span className="text-white/70">{s.avg_score ?? 0} pts</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* ── Pinned Footer Actions ── */}
            <div className="shrink-0 border-t border-white/[0.08] bg-white/[0.02] px-4 py-2.5 space-y-2">
              {note && (
                <p className="text-[10px] text-iris-300 text-center font-medium bg-iris-500/10 border border-iris-500/20 rounded-md py-1 px-2">
                  {note}
                </p>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void exportHistory()}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.05] h-8 px-2.5 text-[11px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 shadow-sm"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  <span>Export</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.05] h-8 px-2.5 text-[11px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 shadow-sm"
                >
                  <Upload className="size-3.5" />
                  <span>Import</span>
                </button>

                <button
                  type="button"
                  onClick={() => void clearHistory()}
                  disabled={busy}
                  title="Delete local practice history"
                  className={`flex items-center justify-center gap-1 rounded-xl border h-8 px-2.5 text-[11px] font-medium transition disabled:pointer-events-none disabled:opacity-40 ${
                    confirmClear
                      ? "border-red-500 bg-red-600 text-white animate-pulse"
                      : "border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
                  }`}
                >
                  <Trash2 className="size-3.5" />
                  <span>{confirmClear ? "Sure?" : "Clear"}</span>
                </button>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importHistory(file)
                  e.target.value = ""
                }}
              />
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Your progress"
        aria-label="Your progress"
        className={`flex size-8 items-center justify-center rounded-xl transition ${
          open
            ? "bg-iris-500/20 text-iris-300 border border-iris-500/30"
            : "text-white/40 hover:bg-white/10 hover:text-white/80"
        }`}
      >
        <History className="size-4" />
      </button>
      {panel}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2 text-center">
      <p className="text-sm font-semibold text-white/90">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-white/40 mt-0.5">{label}</p>
    </div>
  )
}

function TrendIcon({ trend }: { trend: number }) {
  if (trend > 0)
    return <ArrowUpRight className="size-3.5 shrink-0 text-mint-400" />
  if (trend < 0)
    return <ArrowDownRight className="size-3.5 shrink-0 text-red-400" />
  return <Minus className="size-3.5 shrink-0 text-white/30" />
}
