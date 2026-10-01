/** Checks whether Chromium's fake video capture actually delivers frames. */
import puppeteer from "puppeteer-core"

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO || "/tmp/face2.y4m"}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
})

const page = await browser.newPage()
await page.goto(process.argv[2] || "http://127.0.0.1:8001/", {
  waitUntil: "domcontentloaded",
})

const report = await page.evaluate(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true })
  const track = stream.getVideoTracks()[0]
  const video = document.createElement("video")
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  document.body.appendChild(video)
  try {
    await video.play()
  } catch (err) {
    return { playError: String(err) }
  }
  await new Promise((r) => setTimeout(r, 2500))
  const out = {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    readyState: video.readyState,
    label: track.label,
    settings: track.getSettings(),
    devices: (await navigator.mediaDevices.enumerateDevices()).map((d) => ({
      kind: d.kind,
      label: d.label,
    })),
  }
  stream.getTracks().forEach((t) => t.stop())
  return out
})

console.log(JSON.stringify(report, null, 1))
await browser.close()
