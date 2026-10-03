import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Bug, X } from "lucide-react"

import type { ChatStage, VoiceDebug } from "@/hooks/useVoice"

type Props = {
  debug: VoiceDebug
  stage: ChatStage
  error: string | null
  onClose: () => void
}

export default function DebugPanel({ debug, stage, error, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  // levels are waveform RMS (0..~0.4 for loud speech)
  const levelPct = Math.min(100, Math.round(debug.level * 400))
  const thresholdPct = Math.min(100, Math.round(debug.threshold * 400))

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop to capture outside clicks */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      <aside
        className="fixed right-3 sm:right-6 top-14 sm:top-16 z-50 flex flex-col w-[20rem] sm:w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/15 bg-ink-950/95 text-[11px] shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        style={{ maxHeight: "calc(100vh - 4.5rem)" }}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-mint-500/15 text-mint-400 border border-mint-500/20">
              <Bug className="size-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold tracking-wider text-white uppercase">
                Mic Diagnostics
              </h3>
              <p className="text-[10px] text-white/40">Audio stream telemetry</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition"
            aria-label="Close debug panel"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-4 py-3.5 font-mono">
          <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
            <Row label="stage" value={stage} />
            <Row label="session" value={String(debug.session)} />
            <Row label="recorder" value={debug.recorderState} />
            <Row
              label="permission"
              value={debug.permission}
              accent={
                debug.permission === "granted"
                  ? "text-mint-400"
                  : debug.permission === "denied"
                    ? "text-red-400"
                    : undefined
              }
            />
            <Row
              label="analyser"
              value={debug.analyserFlat ? "FLAT — fixed window" : "live"}
              accent={debug.analyserFlat ? "text-amber-300" : "text-mint-400"}
            />
            <Row
              label="spoken"
              value={debug.spoken ? "yes" : "no"}
              accent={debug.spoken ? "text-mint-400" : "text-white/50"}
            />
            <Row
              label="silence"
              value={
                debug.sinceSpeechMs === null ? "—" : `${debug.sinceSpeechMs}ms`
              }
            />
          </div>

          {/* live level vs threshold meter */}
          <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="flex justify-between text-white/45 text-[10px]">
              <span>level {debug.level.toFixed(3)}</span>
              <span>threshold {debug.threshold.toFixed(3)}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-iris-500 to-mint-400 transition-[width] duration-75"
                style={{ width: `${levelPct}%` }}
              />
              {/* threshold marker */}
              <div
                className="absolute top-0 h-full w-0.5 bg-red-400"
                style={{ left: `${thresholdPct}%` }}
                title="speech threshold"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-red-300">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
            <p className="mb-1 text-white/45 text-[10px]">Event Log</p>
            <ul className="max-h-36 space-y-1 overflow-y-auto overscroll-contain pr-1">
              {[...debug.events].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`} className="text-white/70 text-[10px]">
                  <span className="text-white/35 font-mono">
                    {new Date(e.at).toLocaleTimeString([], {
                      hour12: false,
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>{" "}
                  {e.msg}
                </li>
              ))}
              {debug.events.length === 0 && (
                <li className="text-white/35 text-[10px]">(nothing yet — tap the mic)</li>
              )}
            </ul>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  )
}

function Row({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-white/45">{label}</span>
      <span className={accent ?? "text-white/85"}>{value}</span>
    </div>
  )
}
