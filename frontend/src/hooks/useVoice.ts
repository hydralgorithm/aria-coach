import { useCallback, useEffect, useRef, useState } from "react"

export type ChatStage =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"

export type VoiceDebug = {
  session: number
  level: number
  threshold: number
  spoken: boolean
  recorderState: string
  sinceSpeechMs: number | null
  permission: string
  analyserFlat: boolean
  events: { at: number; msg: string }[]
}

const BARS = 24
// A turn ends only after this much *continuous* quiet. Generous on purpose:
// people pause mid-sentence to think, and a short window cuts them off.
const SILENCE_STOP_MS = 1600
// ...and only once they have actually said something.
const MIN_SPEECH_MS = 500
const MAX_RECORD_MS = 40000
const CALIBRATION_MS = 600
const MAX_EVENTS = 40
// speech must be this many times louder than the measured noise floor
const THRESHOLD_MULT = 3.2
const MIN_THRESHOLD = 0.008
const MAX_THRESHOLD = 0.2
const HYSTERESIS = 0.6 // count quiet only below threshold * this
// if the analyser delivers nothing at all, fall back to a fixed window so a
// voice turn still completes (some audio stacks starve the graph)
const ANALYSER_CHECK_MS = 1500
const FALLBACK_RECORD_MS = 10000

function clampThreshold(noiseFloor: number): number {
  return Math.min(
    MAX_THRESHOLD,
    Math.max(MIN_THRESHOLD, noiseFloor * THRESHOLD_MULT)
  )
}

export function useVoice(
  onTranscript: (text: string) => void,
  autoStop = true
) {
  const [stage, setStage] = useState<ChatStage>("idle")
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.06))
  const [error, setError] = useState<string | null>(null)
  const [debug, setDebug] = useState<VoiceDebug>(() => ({
    session: 0,
    level: 0,
    threshold: 0,
    spoken: false,
    recorderState: "none",
    sinceSpeechMs: null,
    permission: "unknown",
    analyserFlat: false,
    events: [],
  }))

  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef<number>(0)
  const analyserRefCurrent = useRef<AnalyserNode | null>(null)
  // every recording session gets an id; stale async callbacks are discarded
  const sessionRef = useRef(0)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript
  const autoStopRef = useRef(autoStop)
  autoStopRef.current = autoStop
  const debugRef = useRef<VoiceDebug>(debug)

  const log = useCallback((msg: string) => {
    const events = debugRef.current.events
    events.push({ at: Date.now(), msg })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }, [])

  // mirror ref-held diagnostics into state a few times per second
  useEffect(() => {
    const id = window.setInterval(() => {
      setDebug({ ...debugRef.current, events: [...debugRef.current.events] })
    }, 150)
    return () => window.clearInterval(id)
  }, [])

  // surface microphone permission state
  useEffect(() => {
    let cancelled = false
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return
        debugRef.current.permission = status.state
        log(`mic permission: ${status.state}`)
        status.onchange = () => {
          debugRef.current.permission = status.state
          log(`mic permission changed: ${status.state}`)
        }
      })
      .catch(() => {
        debugRef.current.permission = "unsupported"
      })
    return () => {
      cancelled = true
    }
  }, [log])

  /** Kill everything belonging to the current session and invalidate it. */
  const teardown = useCallback(
    (reason = "teardown") => {
      sessionRef.current++
      log(`${reason}: session -> ${sessionRef.current}`)
      cancelAnimationFrame(rafRef.current)
      const rec = mediaRef.current
      mediaRef.current = null
      if (rec && rec.state !== "inactive") {
        rec.onstop = null // don't let its onstop run the transcription path
        rec.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      analyserRefCurrent.current = null
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        void ctxRef.current.close()
      }
      ctxRef.current = null
      debugRef.current.recorderState = "none"
      debugRef.current.spoken = false
      debugRef.current.level = 0
      debugRef.current.sinceSpeechMs = null
      setLevels(Array(BARS).fill(0.06))
    },
    [log]
  )

  const finishRecording = useCallback(
    async (session: number, blob: Blob) => {
      if (blob.size < 2000) {
        log(`recording too short (${blob.size}B) — ignored`)
        if (session === sessionRef.current) setStage("idle")
        return
      }
      log(`uploading ${(blob.size / 1024).toFixed(0)}KB to /api/transcribe`)
      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: await blob.arrayBuffer(),
          headers: { "Content-Type": blob.type || "audio/webm" },
        })
        if (!res.ok) throw new Error(`http ${res.status}`)
        const data = (await res.json()) as { text?: string }
        if (session !== sessionRef.current) return // a newer session started
        log(`transcript ok: ${(data.text || "").slice(0, 40) || "(empty)"}`)
        // back to idle so the mic is immediately usable again
        setStage("idle")
        if (data.text) onTranscriptRef.current(data.text)
      } catch (err) {
        log(`transcribe FAILED: ${err instanceof Error ? err.message : err}`)
        if (session !== sessionRef.current) return
        setError("Transcription failed — is the backend running?")
        setStage("idle")
      }
    },
    [log]
  )

  const startVisualizer = useCallback(
    (session: number) => {
      const analyser = analyserRefCurrent.current
      if (!analyser) return
      const freq = new Uint8Array(analyser.frequencyBinCount)
      const wave = new Uint8Array(analyser.fftSize)
      const calibration: number[] = []
      let noiseFloor = MIN_THRESHOLD
      let threshold = MIN_THRESHOLD
      let spoken = false
      let speechStartedAt = 0
      let lastLoudAt = performance.now()
      let calibrated = false
      let sawAnyLevel = false
      let flatReported = false
      const startedAt = performance.now()

      const tick = () => {
        if (session !== sessionRef.current) return // session was killed

        // spectrum for the visual bars
        analyser.getByteFrequencyData(freq)
        const step = Math.floor(freq.length / BARS)
        const next: number[] = []
        for (let i = 0; i < BARS; i++) {
          let bin = 0
          for (let j = 0; j < step; j++) bin += freq[i * step + j]
          next.push(Math.max(0.06, Math.min(1, (bin / step / 255) * 2.4)))
        }
        setLevels(next)

        // true waveform RMS for level detection — reacts to speech far better
        // than a frequency average, which dips between syllables
        analyser.getByteTimeDomainData(wave)
        let sq = 0
        for (let i = 0; i < wave.length; i++) {
          const v = (wave[i] - 128) / 128
          sq += v * v
        }
        const level = Math.sqrt(sq / wave.length)

        const now = performance.now()

        if (now - startedAt < CALIBRATION_MS) {
          calibration.push(level)
        } else if (!calibrated) {
          calibrated = true
          // median (not mean) so talking during calibration can't inflate it
          const sorted = [...calibration].sort((a, b) => a - b)
          noiseFloor = sorted[Math.floor(sorted.length / 2)] ?? MIN_THRESHOLD
          threshold = clampThreshold(noiseFloor)
          log(
            `calibrated: noise=${noiseFloor.toFixed(4)} threshold=${threshold.toFixed(4)}`
          )
        }

        // track the noise floor slowly, only while clearly not speaking
        if (calibrated && level < threshold * HYSTERESIS) {
          noiseFloor = noiseFloor * 0.995 + level * 0.005
          threshold = clampThreshold(noiseFloor)
        }

        if (level > threshold) {
          if (!spoken) {
            spoken = true
            speechStartedAt = now
            log(`speech detected (level=${level.toFixed(4)})`)
          }
          lastLoudAt = now
        }

        if (level > 0.008) sawAnyLevel = true
        // analyser starved? fall back to a fixed recording window
        const analyserFlat =
          !sawAnyLevel && now - startedAt > ANALYSER_CHECK_MS
        if (analyserFlat && !flatReported) {
          flatReported = true
          log(
            `analyser giving no data — using fixed ${FALLBACK_RECORD_MS / 1000}s window`
          )
        }

        // live diagnostics
        const d = debugRef.current
        d.session = session
        d.level = level
        d.threshold = threshold
        d.spoken = spoken
        d.recorderState = mediaRef.current?.state ?? "none"
        d.analyserFlat = analyserFlat
        d.sinceSpeechMs = spoken ? Math.round(now - lastLoudAt) : null

        if (mediaRef.current?.state !== "recording") {
          if (spoken) log("recorder no longer recording — visualizer stopped")
          return
        }

        if (analyserFlat && now - startedAt >= FALLBACK_RECORD_MS) {
          log(`fixed ${FALLBACK_RECORD_MS / 1000}s window reached -> stopping`)
          mediaRef.current.stop()
          return
        }

        // never cut someone off before they have actually spoken for a moment
        const spokeLongEnough =
          spoken && now - speechStartedAt >= MIN_SPEECH_MS
        if (
          autoStopRef.current &&
          spokeLongEnough &&
          now - lastLoudAt >= SILENCE_STOP_MS
        ) {
          log(`paused ${SILENCE_STOP_MS}ms -> stopping`)
          mediaRef.current.stop() // onstop handles cleanup + transcription
          return
        }

        if (now - startedAt >= MAX_RECORD_MS) {
          log("max duration reached -> stopping")
          mediaRef.current.stop()
          return
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    },
    [log]
  )

  /** getUserMedia with one retry — Chrome can briefly hold the old device. */
  const acquireStream = useCallback(async (): Promise<MediaStream> => {
    const constraints: MediaStreamConstraints = {
      audio: { echoCancellation: true, noiseSuppression: true },
    }
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown"
      const denied = name === "NotAllowedError" || name === "SecurityError"
      log(`getUserMedia failed (${name})`)
      if (denied) throw err
      log("retrying getUserMedia in 350ms…")
      await new Promise((r) => setTimeout(r, 350))
      return await navigator.mediaDevices.getUserMedia(constraints)
    }
  }, [log])

  const start = useCallback(async () => {
    teardown("new session") // invalidates previous session + its callbacks
    const session = sessionRef.current
    try {
      setError(null)
      log("requesting mic…")
      const stream = await acquireStream()
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      log(
        `mic open: ${stream.getAudioTracks()[0]?.label || "default device"}`
      )

      const ctx = new AudioContext()
      if (ctx.state === "suspended") await ctx.resume()
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        return
      }
      log(`audio context: ${ctx.state} @ ${ctx.sampleRate}Hz`)

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)
      // Web Audio only processes graphs that reach the destination. Route the
      // analyser through a zero-gain sink so it is pulled (no audible loop,
      // no feedback) — without this, getByteFrequencyData returns all zeros
      // and the VAD can never detect speech.
      const sink = ctx.createGain()
      sink.gain.value = 0
      analyser.connect(sink)
      sink.connect(ctx.destination)
      analyserRefCurrent.current = analyser
      ctxRef.current = ctx

      const mime =
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
          MediaRecorder.isTypeSupported?.(m)
        ) ?? ""
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      )
      chunksRef.current = []

      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }

      rec.onstop = () => {
        // single funnel for manual stop, VAD stop, and max-duration stop
        cancelAnimationFrame(rafRef.current)
        if (streamRef.current === stream) streamRef.current = null
        if (ctxRef.current === ctx) ctxRef.current = null
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        if (analyserRefCurrent.current === analyser) {
          analyserRefCurrent.current = null
        }
        if (mediaRef.current === rec) mediaRef.current = null
        debugRef.current.recorderState = "none"
        setLevels(Array(BARS).fill(0.06))

        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        })
        chunksRef.current = []
        log(`recorder stopped (mime=${rec.mimeType || "default"})`)
        if (session !== sessionRef.current) return // killed mid-recording
        setStage("transcribing")
        void finishRecording(session, blob)
      }

      mediaRef.current = rec
      rec.start()
      debugRef.current.recorderState = rec.state
      setStage("listening")
      log("recording started")
      startVisualizer(session)
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown"
      log(`start FAILED: ${name}`)
      console.error("mic start failed:", err)
      if (session !== sessionRef.current) return
      setError(
        name === "NotAllowedError"
          ? "Microphone permission denied — allow it via the icon in Chrome's address bar"
          : `Microphone unavailable (${name}) — is another app using it?`
      )
      setStage("idle")
    }
  }, [acquireStream, finishRecording, log, startVisualizer, teardown])

  const stop = useCallback(() => {
    const rec = mediaRef.current
    if (rec?.state === "recording") {
      log("manual stop")
      rec.stop() // onstop handles the rest
    }
  }, [log])

  useEffect(() => () => teardown("unmount"), [teardown])

  return { stage, levels, error, start, stop, debug }
}
