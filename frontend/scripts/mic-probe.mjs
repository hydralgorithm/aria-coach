/**
 * Probes the browser audio pipeline directly:
 *   - does getUserMedia deliver real audio (decode the recording, measure RMS)?
 *   - does an AnalyserNode (with silent sink) actually receive data?
 * Prints a JSON report. Usage: node scripts/mic-probe.mjs [url]
 */
import puppeteer from "puppeteer-core"

const URL = process.argv[2] || "about:blank"
const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium"

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-audio-capture=/tmp/mic_test.wav",
    "--autoplay-policy=no-user-gesture-required",
  ],
})

const page = await browser.newPage()
page.on("console", (m) => console.log(`[page] ${m.text()}`))
await page.goto(URL, { waitUntil: "domcontentloaded" })

const report = await page.evaluate(async () => {
  const out = {}
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  out.trackLabel = stream.getAudioTracks()[0]?.label
  out.trackEnabled = stream.getAudioTracks()[0]?.enabled

  const ctx = new AudioContext()
  await ctx.resume()
  out.ctxState = ctx.state
  out.sampleRate = ctx.sampleRate

  const source = ctx.createMediaStreamSource(stream)

  // graph A: analyser with silent gain sink (what the app does now)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(analyser)
  analyser.connect(sink)
  sink.connect(ctx.destination)

  // graph B: analyser with NO downstream connection (the old behaviour)
  const orphan = ctx.createAnalyser()
  orphan.fftSize = 256
  source.connect(orphan)

  const freqA = new Uint8Array(analyser.frequencyBinCount)
  const freqB = new Uint8Array(orphan.frequencyBinCount)
  const timeA = new Uint8Array(analyser.frequencyBinCount)
  let maxA = 0
  let maxB = 0
  let maxTime = 0
  const tick = () => {
    analyser.getByteFrequencyData(freqA)
    orphan.getByteFrequencyData(freqB)
    analyser.getByteTimeDomainData(timeA)
    maxA = Math.max(maxA, Math.max(...freqA))
    maxB = Math.max(maxB, Math.max(...freqB))
    const peak = Math.max(...timeA.map((v) => Math.abs(v - 128)))
    maxTime = Math.max(maxTime, peak)
  }
  const timer = setInterval(tick, 50)

  // record 4 seconds and measure the decoded loudness
  const rec = new MediaRecorder(stream)
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start()
  await new Promise((r) => setTimeout(r, 4000))
  await new Promise((r) => {
    rec.onstop = r
    rec.stop()
  })
  clearInterval(timer)

  const blob = new Blob(chunks, { type: rec.mimeType })
  out.recordedBytes = blob.size
  out.mimeType = rec.mimeType
  const buf = await blob.arrayBuffer()
  try {
    const decoded = await ctx.decodeAudioData(buf)
    const data = decoded.getChannelData(0)
    let sum = 0
    let peak = 0
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i]
      peak = Math.max(peak, Math.abs(data[i]))
    }
    out.decodedRms = Math.sqrt(sum / data.length)
    out.decodedPeak = peak
    out.decodedSeconds = decoded.duration
  } catch (err) {
    out.decodeError = String(err)
  }

  out.analyserWithSink_maxBin = maxA
  out.analyserOrphan_maxBin = maxB
  out.analyserTimeDomain_maxDeviation = maxTime
  return out
})

console.log(JSON.stringify(report, null, 2))
await browser.close()
