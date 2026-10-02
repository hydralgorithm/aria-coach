import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  Mic,
  AudioLines,
  Send,
  RotateCcw,
  Bot,
  User,
  Bug,
  Briefcase,
  MessagesSquare,
  Play,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import DebugPanel from "@/components/DebugPanel"
import InterviewView from "@/components/InterviewView"
import DeliveryMeter from "@/components/DeliveryMeter"
import { useVoice, type ChatStage } from "@/hooks/useVoice"
import { useInterview } from "@/hooks/useInterview"
import { useFaceAnalysis } from "@/hooks/useFaceAnalysis"

type Msg = { id: number; role: "user" | "aria"; text: string }

const STAGE_LABEL: Record<ChatStage, string> = {
  idle: "Tap the mic or type to begin",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Aria is speaking…",
}

const PROMPTS = [
  "Tell me about yourself",
  "Why should we hire you?",
  "Describe a challenge you overcame",
  "Where do you see yourself in 5 years?",
]

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [thinking, setThinking] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [draft, setDraft] = useState("")
  const [showDebug, setShowDebug] = useState(false)
  const [mode, setMode] = useState<"chat" | "interview">("chat")
  // when on, a pause ends your turn; turn it off and only you stop recording
  const [autoStop, setAutoStop] = useState(true)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const nextIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastAudioUrlRef = useRef<string>("")
  const abortRef = useRef<AbortController | null>(null)
  const playbackCancelRef = useRef<(() => void) | null>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    )
  }, [])

  const playAudio = useCallback(async (url: string) => {
    const el = audioRef.current
    if (!el) return
    lastAudioUrlRef.current = url
    setSpeaking(true)
    el.src = url
    try {
      await el.play()
      setPlaybackBlocked(false)
    } catch {
      // never fail silently: surface a manual play button
      setPlaybackBlocked(true)
    }
    // resolvable early so barge-in can cancel playback instantly
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        el.onended = null
        el.onerror = null
        playbackCancelRef.current = null
        resolve()
      }
      el.onended = finish
      el.onerror = finish
      playbackCancelRef.current = finish
    })
    setSpeaking(false)
  }, [])

  const respond = useCallback(
    async (text: string) => {
      abortRef.current?.abort() // drop any in-flight turn being interrupted
      const controller = new AbortController()
      abortRef.current = controller
      setThinking(true)
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        })
        const data = (await res.json()) as {
          reply: string
          audio_url: string
        }
        setMessages((m) => [
          ...m,
          { id: ++nextIdRef.current, role: "aria", text: data.reply },
        ])
        scrollToBottom()
        await playAudio(data.audio_url)
      } catch {
        if (controller.signal.aborted) return // interrupted — stay quiet
        setMessages((m) => [
          ...m,
          {
            id: ++nextIdRef.current,
            role: "aria",
            text: "(Connection to the coach was lost — is the backend running?)",
          },
        ])
        scrollToBottom()
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setSpeaking(false)
        setThinking(false)
      }
    },
    [playAudio, scrollToBottom]
  )

  const handleTranscript = useCallback(
    (text: string) => {
      setMessages((m) => [
        ...m,
        { id: ++nextIdRef.current, role: "user", text },
      ])
      scrollToBottom()
      void respond(text)
    },
    [respond, scrollToBottom]
  )

  const interview = useInterview(playAudio)
  const face = useFaceAnalysis()

  const router = useCallback(
    (text: string) => {
      if (mode === "interview") {
        // the answer just ended — close the delivery window and report it
        void interview.submitAnswer(text, face.endTurn())
      } else {
        handleTranscript(text)
      }
    },
    [mode, interview, handleTranscript, face]
  )

  const { stage, levels, error, start, stop, debug } = useVoice(router, autoStop)

  // 'd' toggles the mic diagnostics panel (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "d" || e.metaKey || e.ctrlKey) return
      const target = e.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return
      setShowDebug((v) => !v)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  /** start a voice turn, opening a delivery-analysis window when relevant */
  const startAnswering = useCallback(() => {
    if (mode === "interview") face.beginTurn()
    start()
  }, [mode, face, start])

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause()
    playbackCancelRef.current?.()
  }, [])

  const interruptToListen = useCallback(() => {
    abortRef.current?.abort()
    stopPlayback()
    setThinking(false)
    setSpeaking(false)
    start()
  }, [start, stopPlayback])

  // Spacebar: interrupt Aria / push-to-talk (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return
      const target = e.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return
      e.preventDefault()
      if (stage === "listening") stop()
      else if (speaking || thinking) interruptToListen()
      else if (stage === "idle") start()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stage, speaking, thinking, start, stop, interruptToListen])

  const onMicClick = () => {
    if (stage === "listening") stop()
    else if (speaking || thinking) interruptToListen()
    else if (stage === "idle") startAnswering()
  }

  const onSubmitText = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || stage === "listening" || stage === "transcribing") return
    setDraft("")
    stopPlayback() // typing a follow-up also cuts Aria off
    if (mode === "interview") {
      // typed answers are analysed too: open a delivery window on focus and
      // close it on send, otherwise the camera window covers the wrong span
      void interview.submitAnswer(text, face.endTurn())
      return
    }
    setMessages((m) => [...m, { id: ++nextIdRef.current, role: "user", text }])
    scrollToBottom()
    void respond(text)
  }

  const reset = () => {
    abortRef.current?.abort()
    stopPlayback()
    setThinking(false)
    setSpeaking(false)
    if (mode === "interview") {
      void interview.reset()
      return
    }
    setMessages([])
    void fetch("/api/reset", { method: "POST" })
  }

  const micBusy = stage === "transcribing"

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="aurora-bg" />
      <div className="grid-overlay" />

      {/* header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <img
            src="/catdance.gif"
            alt="Aria"
            className="size-10 shrink-0 rounded-2xl bg-ink-800 object-cover shadow-lg shadow-iris-600/40"
          />
          <div>
            <h1 className="text-sm font-semibold tracking-wide">ARIA</h1>
            <p className="text-xs text-white/50">
              voice interview coach · step 1: conversation
            </p>
          </div>
          <div className="ml-3 flex rounded-full border border-white/10 bg-white/5 p-0.5">
            {(
              [
                ["chat", "Free chat", MessagesSquare],
                ["interview", "Interview coach", Briefcase],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition ${
                  mode === value
                    ? "bg-white/15 text-white"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowDebug((v) => !v)}
            aria-label="Toggle mic diagnostics"
            title="Mic diagnostics (D)"
            className={showDebug ? "text-mint-400" : ""}
          >
            <Bug />
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RotateCcw /> New session
          </Button>
        </div>
      </header>

      {mode === "interview" ? (
        <main className="relative z-10 flex-1 overflow-y-auto pb-4">
          <InterviewView
            filename={interview.filename}
            profile={interview.profile}
            structured={interview.structured}
            questions={interview.questions}
            answers={interview.answers}
            currentQuestion={interview.currentQuestion}
            personas={interview.personas}
            activePersona={interview.activePersona}
            analyzing={interview.analyzing}
            scoring={interview.scoring}
            error={interview.error}
            onUpload={(f) => void interview.loadResume(f)}
            onPersona={(id) => void interview.choosePersona(id)}
            onReset={() => void interview.reset()}
            stage={stage}
            levels={levels}
            speaking={speaking}
            start={startAnswering}
            stop={stop}
            deliverySummary={interview.deliverySummary}
          />
        </main>
      ) : (
      <main
        ref={scrollRef}
        className="relative z-10 flex-1 space-y-4 overflow-y-auto px-6 pb-4"
      >
        <AnimatePresence initial={false}>
          {messages.length === 0 && !thinking && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-auto mt-[16vh] max-w-lg text-center"
            >
              <img
                src="/catdance.gif"
                alt="Aria"
                className="mx-auto mb-5 size-16 rounded-3xl bg-ink-800 object-cover shadow-2xl shadow-iris-600/50"
              />
              <h2 className="text-2xl font-semibold tracking-tight">
                Hey, I'm Aria
              </h2>
              <p className="mt-2 text-sm text-white/55">
                Tap the mic and speak — I'll listen, think, and answer out
                loud. Or just type below.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => void respond(p)}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className={`flex gap-3 ${
                m.role === "user" ? "flex-row-reverse" : ""
              }`}
            >
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${
                  m.role === "aria"
                    ? "bg-gradient-to-br from-iris-500 to-iris-600"
                    : "bg-white/10"
                }`}
              >
                {m.role === "aria" ? (
                  <Bot className="size-4" />
                ) : (
                  <User className="size-4" />
                )}
              </div>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "aria"
                    ? "border border-white/10 bg-white/[0.06] text-white/90"
                    : "bg-gradient-to-br from-iris-600 to-iris-500 text-white shadow-lg shadow-iris-600/25"
                }`}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
          {thinking && <ThinkingBubble />}
        </AnimatePresence>
      </main>
      )}

      {/* composer */}
      <footer className="relative z-10 px-6 pb-6">
        {error && (
          <p className="mx-auto mb-2 max-w-2xl text-center text-xs text-red-400">
            {error}
          </p>
        )}
        {playbackBlocked && (
          <div className="mx-auto mb-2 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2">
            <span className="text-xs text-amber-200">
              Audio playback was blocked by the browser.
            </span>
            <Button
              variant="outline"
              onClick={() => void playAudio(lastAudioUrlRef.current)}
            >
              <Play /> Play reply
            </Button>
          </div>
        )}
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Button
            onClick={onMicClick}
            disabled={micBusy}
            className={`relative size-12 shrink-0 rounded-2xl ${
              speaking || thinking
                ? "bg-white/15 shadow-none hover:bg-white/25"
                : ""
            }`}
            aria-label={
              stage === "listening"
                ? "Stop listening"
                : speaking || thinking
                  ? "Interrupt and talk"
                  : "Start talking"
            }
          >
            {stage === "listening" && (
              <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-iris-500/60" />
            )}
            {stage === "listening" ? (
              <AudioLines className="size-5" />
            ) : speaking || thinking ? (
              <Mic className="size-5 animate-pulse" />
            ) : (
              <Mic className="size-5" />
            )}
          </Button>

          <form onSubmit={onSubmitText} className="flex flex-1 gap-2">
            <Input
              value={draft}
              onFocus={() => {
                // opening a delivery window when the user starts typing keeps
                // typed answers measured over the span they were composed
                if (mode === "interview") face.beginTurn()
              }}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                stage === "listening"
                  ? "Listening…"
                  : speaking
                    ? "Interrupt with text…"
                    : thinking
                      ? "Type to interrupt…"
                      : STAGE_LABEL[stage]
              }
              disabled={stage === "listening"}
            />
            <Button
              type="submit"
              disabled={
                !draft.trim() ||
                stage === "listening" ||
                stage === "transcribing"
              }
            >
              <Send />
            </Button>
          </form>
        </div>

        {/* waveform + status */}
        <div className="mx-auto mt-3 flex h-8 max-w-2xl items-center gap-3">
          <div className="flex h-8 flex-1 items-end gap-1">
            {stage === "listening" ? (
              levels.map((l, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-iris-400 transition-[height] duration-75"
                  style={{ height: `${Math.round(4 + l * 28)}px` }}
                />
              ))
            ) : (
              <span className="text-xs text-white/40">
                {mode === "interview" && interview.analyzing
                  ? "Reading your resume and writing tailored questions…"
                  : mode === "interview" && interview.scoring
                    ? "Scoring your answer…"
                    : speaking
                      ? "Aria is speaking — tap the mic or press Space to jump in"
                      : thinking
                        ? "Thinking — you can interrupt with voice or text"
                        : STAGE_LABEL[stage]}
              </span>
            )}
          </div>
          <button
            onClick={() => setAutoStop((v) => !v)}
            title={
              autoStop
                ? "Your turn is sent after a pause. Turn off to stop recording only when you tap the mic."
                : "Recording continues until you tap the mic. Turn on to send automatically after a pause."
            }
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] tracking-wide uppercase transition ${
              autoStop
                ? "border-mint-400/40 bg-mint-400/10 text-mint-400"
                : "border-white/15 bg-white/5 text-white/50 hover:text-white/80"
            }`}
          >
            {autoStop ? "auto-send on pause" : "manual stop"}
          </button>
        </div>
        <audio ref={audioRef} hidden />
      </footer>

      {mode === "interview" && interview.questions.length > 0 && (
        <DeliveryMeter
          videoRef={face.videoRef}
          metrics={face.metrics}
          enabled={face.enabled}
          loading={face.loading}
          onToggle={() => (face.enabled ? face.stop() : void face.start())}
        />
      )}

      {showDebug && (
        <DebugPanel
          debug={debug}
          stage={stage}
          error={error}
          onClose={() => setShowDebug(false)}
        />
      )}
    </div>
  )
}

function ThinkingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex gap-3"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-iris-500 to-iris-600">
        <Bot className="size-4" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-white/50"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </motion.div>
  )
}
