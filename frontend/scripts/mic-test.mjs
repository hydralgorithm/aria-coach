/**
 * End-to-end mic test: launches Chromium with a fake microphone fed from a WAV
 * file, drives the real UI, and dumps the in-app debug event log.
 *
 *   node scripts/mic-test.mjs [url]
 */
import puppeteer from "puppeteer-core"

const URL = process.argv[2] || "http://127.0.0.1:8000"
const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium"

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${process.env.FAKE_MIC_FILE || "/tmp/mic_pause_test.wav"}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
})

const page = await browser.newPage()
const logs = []
page.on("console", (m) => logs.push(`[console:${m.type()}] ${m.text()}`))
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`))
page.on("requestfailed", (r) =>
  logs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`)
)
page.on("response", (r) => {
  if (r.url().includes("/api/")) {
    logs.push(`[api] ${r.status()} ${r.request().method()} ${r.url()}`)
  }
})

await page.goto(URL, { waitUntil: "networkidle2" })
console.log("== page loaded ==")

// open the diagnostics panel
await page.keyboard.press("d")
await new Promise((r) => setTimeout(r, 300))

const beforeClick = await page.evaluate(() => ({
  micLabel: document
    .querySelector("button[aria-label]")
    ?.getAttribute("aria-label"),
  buttons: [...document.querySelectorAll("button[aria-label]")].map((b) =>
    b.getAttribute("aria-label")
  ),
}))
console.log("mic buttons:", JSON.stringify(beforeClick))

// click the mic
const micSel = 'button[aria-label="Start talking"]'
await page.waitForSelector(micSel, { timeout: 5000 })
await page.click(micSel)
console.log("== clicked mic, recording should start ==")

// let the fake audio play through the VAD
await new Promise((r) => setTimeout(r, 12000))

const dump = await page.evaluate(() => {
  const status = document.querySelector("footer .text-white\\/40")?.textContent
  const rows = [...document.querySelectorAll("aside .font-mono > div")].map(
    (d) => d.textContent
  )
  const events = [...document.querySelectorAll("aside li")].map(
    (li) => li.textContent
  )
  const errorBanner = [...document.querySelectorAll("p")]
    .map((p) => p.textContent)
    .filter((t) => t && t.includes("—"))
  const bubbles = [...document.querySelectorAll("main .rounded-2xl")].map(
    (d) => d.textContent?.slice(0, 90)
  )
  return { status, rows, events, errorBanner, bubbles }
})

console.log("\n== in-app debug rows ==")
console.log(dump.rows.join("\n"))
console.log("\n== debug event log ==")
console.log(dump.events.reverse().join("\n"))
console.log("\n== status line ==", dump.status)
console.log("\n== banners ==", JSON.stringify(dump.errorBanner))
console.log("\n== chat/message bubbles ==", JSON.stringify(dump.bubbles))
console.log("\n== browser + network log ==")
console.log(logs.slice(-40).join("\n"))

await browser.close()
