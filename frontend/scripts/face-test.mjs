/**
 * Verifies webcam delivery analysis end-to-end:
 *   launches Chromium with a fake camera fed from a video file (a real face),
 *   enters interview mode, uploads a resume, enables delivery analysis and
 *   reports the live metrics it reads from the panel.
 *
 *   node scripts/face-test.mjs [url] [resumePath]
 */
import puppeteer from "puppeteer-core"

const URL = process.argv[2] || "http://127.0.0.1:8000"
const RESUME = process.argv[3] || "/tmp/resume.pdf"
const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO || "/tmp/face.y4m"}`,
    `--use-file-for-fake-audio-capture=${process.env.FAKE_MIC_FILE || "/tmp/mic_test.wav"}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
})

const page = await browser.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`))
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`)
})
page.on("requestfailed", (r) =>
  errors.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`)
)

await page.goto(URL, { waitUntil: "networkidle2" })
console.log("== loaded ==")

// switch to interview mode
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Interview coach")
  )
  if (btn) btn.click()
})
await sleep(500)
console.log("== interview mode ==")

// upload the resume
const input = await page.$('input[type="file"]')
if (!input) throw new Error("file input not found")
await input.uploadFile(RESUME)
console.log("== resume uploaded, waiting for generated questions ==")

let ready = false
for (let i = 0; i < 90; i++) {
  await sleep(1000)
  // the session view is the only place with the "New resume" control
  const loaded = await page.evaluate(() =>
    Boolean(document.querySelector('button[title="New resume"]'))
  )
  if (loaded) {
    ready = true
    break
  }
}
console.log("questions ready:", ready)

// enable delivery analysis
const btnState = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Delivery analysis")
  )
  if (btn) btn.click()
  return { found: !!btn, text: btn?.textContent ?? null }
})
console.log("camera button:", JSON.stringify(btnState))
console.log("== camera enabled, analysing for 10s ==")
await sleep(10000)

const report = await page.evaluate(() => {
  const panel = [...document.querySelectorAll("aside")].find((a) =>
    a.textContent?.includes("DELIVERY ANALYSIS")
  )
  const video = document.querySelector("video")
  return {
    panelText: panel?.innerText ?? null,
    videoSize: video
      ? { w: video.videoWidth, h: video.videoHeight, ready: video.readyState }
      : null,
    cameraErrorText:
      [...document.querySelectorAll("p")]
        .map((p) => p.textContent)
        .filter((t) => t && /camera|permission|unavailable/i.test(t)) ?? [],
    hasCameraButton: [...document.querySelectorAll("button")].some((b) =>
      b.textContent?.includes("Delivery analysis")
    ),
  }
})

console.log("\n== delivery panel ==")
console.log(report.panelText ?? "(panel not found — is delivery analysis on?)")
console.log("\n== video element ==", JSON.stringify(report.videoSize))
console.log("== camera button still present ==", report.hasCameraButton)
console.log("== camera errors ==", JSON.stringify(report.cameraErrorText))
console.log("\n== errors ==")
console.log(errors.slice(0, 12).join("\n") || "(none)")

await browser.close()
