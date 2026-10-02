import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  Mic,
  AudioLines,
  Send,
  RotateCcw,
  User,
  Bug,
  Briefcase,
  MessagesSquare,
  Play,
  Sparkles,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { AvatarOrb } from "@/components/ui/avatar-orb"
import { SiriOrb } from "@/components/ui/siri-orb"
import { BorderBeam } from "@/components/ui/border-beam"
import DebugPanel from "@/components/DebugPanel"
import InterviewView from "@/components/InterviewView"
import CameraSetup from "@/components/CameraSetup"
import WhereItRuns from "@/components/WhereItRuns"
// Practice history & progress panel
import ProgressPanel from "@/components/ProgressPanel"
import ValidationPanel from "@/components/ValidationPanel"
import { useVoice, type ChatStage } from "@/hooks/useVoice"
import { useInterview } from "@/hooks/useInterview"
import { useFaceAnalysis } from "@/hooks/useFaceAnalysis"

type Msg = { id: number; role: "user" | "aria"; text: string }

const STAGE_LABEL: Record<ChatStage, string> = {
  idle: "Ask me anything…",
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
  const [autoStop, setAutoStop] = useState(true)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const nextIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastAudioUrlRef = useRef<string>("")
  const abortRef = useRef<AbortController | null>(null)
  const playbackCancelRef = useRef<(() => void) | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea (Bolt-style)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    )
  }, [])

  const stopPlayback = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    playbackCancelRef.current?.()
    playbackCancelRef.current = null
    setSpeaking(false)
  }, [])

  const playAudio = useCallback(
    async (url: string) => {
      const el = audioRef.current
      if (!el) return
      stopPlayback()
      lastAudioUrlRef.current = url
      setSpeaking(true)
      el.src = url
      try {
        await el.play()
        setPlaybackBlocked(false)
      } catch {
        setPlaybackBlocked(true)
      }
      await new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          el.onended = null
          el.onerror = null
          if (playbackCancelRef.current === finish) {
            playbackCancelRef.current = null
          }
          resolve()
        }
        el.onended = finish
        el.onerror = finish
        playbackCancelRef.current = finish
      })
      if (audioRef.current?.src.endsWith(url)) {
        setSpeaking(false)
      }
    },
    [stopPlayback]
  )

  const respond = useCallback(
    async (text: string) => {
      abortRef.current?.abort()
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
        const data = (await res.json()) as { reply: string; audio_url: string }
        setMessages((m) => [...m, { id: ++nextIdRef.current, role: "aria", text: data.reply }])
        scrollToBottom()
        await playAudio(data.audio_url)
      } catch {
        if (controller.signal.aborted) return
        setMessages((m) => [
          ...m,
          { id: ++nextIdRef.current, role: "aria", text: "(Connection to the coach was lost — is the backend running?)" },
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
      setMessages((m) => [...m, { id: ++nextIdRef.current, role: "user", text }])
      scrollToBottom()
      void respond(text)
    },
    [respond, scrollToBottom]
  )

  const interview = useInterview(playAudio, stopPlayback)
  const face = useFaceAnalysis()

  const router = useCallback(
    (text: string) => {
      // Interview answers stop at the transcript gate: capture the camera-setup
      // window now, but score only after the user confirms/fixes the transcript.
      if (mode === "interview") {
        if (interview.questions.length > 0)
          interview.reviewAnswer(
            text,
            face.endTurn(),
            interview.retryTarget?.question.id
          )
        else void interview.submitAnswer(text, face.endTurn()) // surfaces the error
      } else handleTranscript(text)
    },
    [mode, interview, handleTranscript, face]
  )

  const { stage, levels, error, start, stop, debug } = useVoice(router, autoStop)

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

  const startAnswering = useCallback(() => {
    if (mode === "interview" && interview.pending) return
    if (mode === "interview") face.beginTurn()
    start()
  }, [mode, face, start, interview.pending])

  const interruptToListen = useCallback(() => {
    abortRef.current?.abort()
    stopPlayback()
    setThinking(false)
    setSpeaking(false)
    start()
  }, [start, stopPlayback])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return
      const target = e.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return
      e.preventDefault()
      if (stage === "listening") stop()
      else if (speaking || thinking) interruptToListen()
      else if (stage === "idle" && !(mode === "interview" && interview.pending))
        start()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stage, speaking, thinking, start, stop, interruptToListen, mode, interview.pending])

  const onMicClick = () => {
    if (stage === "listening") stop()
    else if (speaking || thinking) interruptToListen()
    else if (stage === "idle") startAnswering()
  }

  const onSubmitText = (e?: React.FormEvent) => {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || stage === "listening" || stage === "transcribing") return
    setDraft("")
    stopPlayback()
    if (mode === "interview") {
      // if the transcript gate is open, typed text becomes the corrected answer
      if (interview.pending) void interview.confirmPending(text, false)
      else if (interview.retryTarget)
        void interview.retryAnswer(
          text,
          face.endTurn(),
          interview.retryTarget.question.id
        )
      else void interview.submitAnswer(text, face.endTurn())
      return
    }
    setMessages((m) => [...m, { id: ++nextIdRef.current, role: "user", text }])
    scrollToBottom()
    void respond(text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSubmitText()
    }
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
  const isListening = stage === "listening"
  const isThinkingOrSpeaking = speaking || thinking

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="aurora-bg" />
      <div className="grid-overlay" />
      {/* Radiant ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 -top-[160px] -translate-x-1/2 w-[900px] h-[380px] opacity-60 z-0"
        style={{
          background: "radial-gradient(ellipse at center, rgba(110, 46, 224, 0.28) 0%, rgba(20, 136, 252, 0.12) 45%, transparent 70%)"
        }}
      />

      {/* ── Header ── */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-ink-950/60 px-4 sm:px-6 py-2.5 backdrop-blur-xl shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <AvatarOrb color="violet" size="sm" shape="circle" blinking />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold tracking-widest text-white">ARIA</h1>
              <span className="flex items-center gap-0.5 rounded-full border border-iris-400/40 bg-iris-500/15 px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-iris-300">
                <Zap className="size-2.5" />
                AI
              </span>
            </div>
            <p className="text-[10px] text-white/40 tracking-wide hidden sm:block">voice interview coach</p>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="order-3 sm:order-2 flex mx-auto sm:mx-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5 backdrop-blur-xl shadow-lg shadow-black/20">
          {(
            [
              ["chat", "Free chat", MessagesSquare],
              ["interview", "Interview coach", Briefcase],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => { stopPlayback(); setMode(value) }}
              className={`relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                mode === value ? "text-white" : "text-white/45 hover:text-white/70"
              }`}
            >
              {mode === value && (
                <motion.span
                  layoutId="mode-pill"
                  className="absolute inset-0 rounded-full bg-white/12 shadow-inner shadow-white/5"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className="relative size-3.5" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="order-2 sm:order-3 flex items-center gap-1.5">
          <ProgressPanel />
          <ValidationPanel />
          <WhereItRuns />
          <button
            onClick={() => setShowDebug((v) => !v)}
            title="Mic diagnostics (D)"
            className={`flex size-8 items-center justify-center rounded-xl transition hover:bg-white/10 ${
              showDebug ? "text-mint-400" : "text-white/40 hover:text-white/70"
            }`}
          >
            <Bug className="size-4" />
          </button>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/55 transition hover:bg-white/10 hover:text-white/80"
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">New session</span>
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      {mode === "interview" ? (
        <main className="relative z-10 flex-1 min-h-0 overflow-y-auto pb-4">
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
            onUpload={(f, jd) => void interview.loadResume(f, jd)}
            onApplyJd={(jd) => void interview.applyJd(jd)}
            jd={interview.jd}
            coverage={interview.coverage}
            onPersona={(id) => void interview.choosePersona(id)}
            onReset={() => void interview.reset()}
            stage={stage}
            levels={levels}
            speaking={speaking}
            start={startAnswering}
            stop={stop}
            setupSummary={interview.setupSummary}
            parse={interview.parse}
            pending={interview.pending}
            onConfirmPending={(t, edited) =>
              void interview.confirmPending(t, edited)
            }
            onDiscardPending={() => interview.discardPending()}
            retrying={interview.retrying}
            retryTarget={interview.retryTarget}
            retryResults={interview.retryResults}
            onRetry={(q, i) => interview.startRetry(q, i)}
            onRetryAnswer={(t) => {
              const target = interview.retryTarget
              if (target)
                void interview.retryAnswer(t, face.endTurn(), target.question.id)
            }}
            onCancelRetry={() => interview.cancelRetry()}
            behaviour={interview.behaviour}
          />
        </main>
      ) : (
        <main
          ref={scrollRef}
          className="relative z-10 flex-1 min-h-0 space-y-5 overflow-y-auto px-4 sm:px-6 pb-4 pt-4"
        >
          <AnimatePresence initial={false}>
            {/* Welcome screen */}
            {messages.length === 0 && !thinking && (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="mx-auto my-auto max-w-xl text-center py-6 px-4"
              >
                {/* Announcement badge */}
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1 text-xs text-white/70 backdrop-blur-xl">
                  <Sparkles className="size-3 text-iris-300" />
                  <span>Real-Time Voice AI Interview Practice</span>
                </div>

                {/* Large Avatar orb */}
                <div className="relative mx-auto mb-5 w-fit">
                  <AvatarOrb color="violet" size="lg" shape="circle" blinking className="mx-auto" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  Meet{" "}
                  <span className="bg-gradient-to-r from-iris-300 via-indigo-300 to-mint-400 bg-clip-text text-transparent">
                    Aria
                  </span>
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-white/50 max-w-md mx-auto">
                  Your conversational interview coach. Tap the mic and speak — Aria listens, thinks, and answers with natural voice. Or type below.
                </p>
                <div className="mt-7 flex flex-wrap justify-center gap-2">
                  {PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => void respond(p)}
                      className="group flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs text-white/70 transition-all duration-200 hover:border-iris-400/40 hover:bg-iris-500/10 hover:text-white active:scale-95"
                    >
                      <Sparkles className="size-3 text-iris-400 opacity-50 transition group-hover:opacity-100" />
                      {p}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Chat messages */}
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 360, damping: 28 }}
                className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                {m.role === "aria" ? (
                  <AvatarOrb color="violet" size="sm" shape="circle" blinking={false} />
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                    <User className="size-4" />
                  </div>
                )}

                {/* Bubble */}
                <div
                  className={`max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg ${
                    m.role === "aria"
                      ? "rounded-tl-sm border border-white/[0.08] bg-white/[0.05] text-white/88 backdrop-blur-xl shadow-black/20"
                      : "rounded-tr-sm bg-gradient-to-br from-iris-600 to-iris-500 text-white shadow-iris-600/20"
                  }`}
                >
                  {m.text}
                </div>
              </motion.div>
            ))}

            {/* ThinkingOrb while waiting for response */}
            {thinking && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex gap-3"
              >
                <div className="flex size-8 shrink-0 items-center justify-center">
                  <SiriOrb
                    size="32px"
                    animationDuration={12}
                    colors={{
                      bg: "oklch(12% 0.02 264)",
                      c1: "oklch(65% 0.22 290)",
                      c2: "oklch(75% 0.18 200)",
                      c3: "oklch(60% 0.25 270)",
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-white/[0.08] bg-white/[0.05] px-4 py-2.5 text-xs text-white/40 backdrop-blur-xl">
                  Aria is thinking…
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      )}

      {/* ── Composer ── */}
      <footer className="relative z-10 px-5 pb-5">
        {/* Notices */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mb-2.5 max-w-2xl text-center text-xs text-red-400"
          >
            {error}
          </motion.p>
        )}
        {playbackBlocked && (
          <div className="mx-auto mb-2.5 flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-2.5">
            <span className="text-xs text-amber-200/80">Audio playback was blocked by the browser.</span>
            <Button variant="outline" onClick={() => void playAudio(lastAudioUrlRef.current)} className="h-7 gap-1.5 px-3 py-0 text-[11px]">
              <Play className="size-3" /> Play reply
            </Button>
          </div>
        )}

        {/* Bolt-style composer — BorderBeam wraps while Aria is speaking */}
        <div className="mx-auto max-w-2xl">
          <ComposerBeamWrapper speaking={speaking}>
            <div className="rounded-2xl border border-white/[0.08] bg-[#1e1e22] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_4px_24px_rgba(0,0,0,0.4)] overflow-hidden">
              {/* Textarea row */}
              <div className="px-4 pt-4 pb-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  disabled={isListening}
                  onFocus={() => { if (mode === "interview") face.beginTurn() }}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    isListening ? "Listening…" :
                    speaking ? "Interrupt with text…" :
                    thinking ? "Type to interrupt…" :
                    STAGE_LABEL[stage]
                  }
                  rows={1}
                  className="w-full resize-none bg-transparent text-sm text-white/90 placeholder:text-white/30 outline-none disabled:opacity-50 min-h-[32px] max-h-[160px] leading-relaxed"
                  style={{ height: "32px" }}
                />
              </div>
              {/* Toolbar row */}
              <div className="flex items-center gap-2 px-3 pb-3">
                {/* Mic */}
                <button
                  onClick={onMicClick}
                  disabled={micBusy}
                  aria-label={isListening ? "Stop" : isThinkingOrSpeaking ? "Interrupt" : "Speak"}
                  className={`relative flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 disabled:pointer-events-none disabled:opacity-40 ${
                    isListening
                      ? "bg-gradient-to-br from-iris-500 to-iris-600 shadow-lg shadow-iris-600/40"
                      : isThinkingOrSpeaking
                        ? "bg-white/10 text-white/60 hover:bg-white/15"
                        : "bg-gradient-to-br from-iris-600 to-iris-500 shadow-md shadow-iris-600/30 hover:scale-105"
                  }`}
                >
                  {isListening && <span className="absolute inset-0 animate-pulse-ring rounded-xl bg-iris-500/50" />}
                  {isListening ? <AudioLines className="size-4" /> : <Mic className="size-4" />}
                </button>
                {/* Status */}
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  {isListening ? (
                    <div className="flex h-6 items-end gap-0.5">
                      {levels.map((l, i) => (
                        <span key={i} className="w-1 rounded-full bg-iris-400 transition-[height] duration-75" style={{ height: `${Math.round(3 + l * 22)}px` }} />
                      ))}
                    </div>
                  ) : speaking ? (
                    <div className="flex items-center gap-2 text-iris-300 min-w-0">
                      <div className="speaking-bars shrink-0"><span /><span /><span /><span /><span /></div>
                      <span className="text-xs truncate">Speaking — tap mic or Space to jump in</span>
                    </div>
                  ) : thinking ? (
                    <span className="text-xs text-white/35">Thinking — interrupt with voice or text</span>
                  ) : (
                    <span className="text-xs text-white/25">
                      {mode === "interview" && interview.analyzing ? "Analysing resume…" :
                       mode === "interview" && interview.scoring ? "Scoring answer…" :
                       "Space · push-to-talk · Shift+Enter for newline"}
                    </span>
                  )}
                </div>
                {/* Auto toggle */}
                <button
                  onClick={() => setAutoStop((v) => !v)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] tracking-wide uppercase transition ${
                    autoStop ? "border-mint-400/40 bg-mint-400/10 text-mint-400" : "border-white/10 bg-white/[0.04] text-white/35 hover:text-white/60"
                  }`}
                >
                  {autoStop ? "auto" : "manual"}
                </button>
                {/* Send */}
                <button
                  onClick={() => onSubmitText()}
                  disabled={!draft.trim() || isListening || stage === "transcribing"}
                  className="flex size-9 items-center justify-center rounded-xl bg-iris-600 text-white shadow-md shadow-iris-600/30 transition hover:bg-iris-500 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </ComposerBeamWrapper>
        </div>
        <audio ref={audioRef} hidden />
      </footer>

      {/* ── Camera setup check ── */}
      {mode === "interview" && interview.questions.length > 0 && (
        <CameraSetup
          videoRef={face.videoRef}
          metrics={face.metrics}
          enabled={face.enabled}
          loading={face.loading}
          onToggle={() => (face.enabled ? face.stop() : void face.start())}
        />
      )}

      {/* ── Debug panel ── */}
      {showDebug && (
        <DebugPanel debug={debug} stage={stage} error={error} onClose={() => setShowDebug(false)} />
      )}
    </div>
  )
}

/** Wraps children in BorderBeam when Aria is speaking, passthrough otherwise */
function ComposerBeamWrapper({ speaking, children }: { speaking: boolean; children: React.ReactNode }) {
  if (speaking) {
    return (
      <BorderBeam
        size="md"
        colorVariant="ocean"
        strength={0.85}
        brightness={1.0}
        glowSize={0.5}
        borderRadius={16}
        className="rounded-2xl"
      >
        {children}
      </BorderBeam>
    )
  }
  return <>{children}</>
}
