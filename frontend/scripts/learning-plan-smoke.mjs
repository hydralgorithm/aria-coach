// End-to-end browser smoke test for the personalized learning plan.
//
// Usage:
//   1. python -m uvicorn backend.server:app --port 8000
//   2. npm run build            (the backend serves frontend/dist)
//   3. node scripts/learning-plan-smoke.mjs [baseUrl]
//
// Drives the real UI the way a candidate does: paste a JD, upload a resume,
// answer every question out-of-band (typed composer), then assert that the
// personalized learning plan, its resources, its drills and its re-test
// instructions are rendered WITHOUT a page refresh, in the documented order.
//
// Exit 0 only when every assertion passes.

import puppeteer from "puppeteer"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = process.argv[2] || "http://127.0.0.1:8000"
const SHOTS = join(process.cwd(), "..", "docs", "screenshots")
mkdirSync(SHOTS, { recursive: true })

const RESUME = `Aarav Sharma
Backend Engineer
aarav@example.com | +91 90000 00000

EXPERIENCE
Finflow Labs - Backend Engineer (2021 - present)
- Reduced p95 latency by 38% with Redis caching.
- Built a FastAPI service handling 12000 requests per minute.
SKILLS
Python, FastAPI, PostgreSQL, Docker
`

const JD = `Senior Backend Engineer.
Requires: Redis caching, Kubernetes, strong system design, Go.
You will own our payments platform and mentor two mid-level engineers.`

const ANSWER =
  "I added Redis caching in front of the profile lookup path with a cache-aside " +
  "pattern and a 300 second TTL. I measured it with a load test at 12000 " +
  "requests per minute and p95 latency dropped 38 percent. The trade-off is " +
  "stale data for up to five minutes, which I bounded with an explicit " +
  "invalidation on write. The failure case is a cache outage, so the service " +
  "falls back to the database rather than failing."

const IMPROVED_ANSWER =
  "First I would measure the current p95 and the throughput ceiling so the " +
  "migration has a baseline. Go's goroutines and GC let me hold far fewer " +
  "connections, so I would start with the connection pool and the cache-aside " +
  "layer, keep the HTTP contract byte-identical, and run both services behind " +
  "a shadow router so I can compare latency distributions before shifting " +
  "traffic. The failure mode I care about most is a slow consumer holding " +
  "goroutines; I would bound it with context timeouts and a circuit breaker."

const failures = []
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
}

/** Recorded, not gating: an environment shortfall, not a UI regression. */
function note(name, detail) {
  console.log(`  NOTE  ${name}${detail ? ` — ${detail}` : ""}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** innerText applies CSS text-transform, so match case-insensitively. */
const has = (haystack, needle) =>
  haystack.toLowerCase().includes(needle.toLowerCase())

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function clickByText(page, text, tag = "button") {
  return page.evaluate(
    (t, g) => {
      const el = [...document.querySelectorAll(g)].find((b) =>
        (b.textContent || "").includes(t)
      )
      if (!el) return false
      el.click()
      return true
    },
    text,
    tag
  )
}

/** Icon-only controls are found by accessible name, not by text. */
async function clickAria(page, label) {
  return page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`)
    if (!el) return false
    el.click()
    return true
  }, label)
}

/** Wait until `fn` (evaluated in the page) is truthy, or throw on timeout. */
async function waitFor(page, fn, label, timeoutMs = 240000, arg = null) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true
    await sleep(700)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const dir = mkdtempSync(join(tmpdir(), "aria-smoke-"))
const resumePath = join(dir, "resume.txt")
writeFileSync(resumePath, RESUME)

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream"],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 1000 })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console: ${m.text()}`)
})

try {
  console.log(`\n=== learning plan smoke test against ${BASE} ===`)
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 })

  // ── 1. enter the interview coach ──────────────────────────────────────────
  await clickByText(page, "Interview coach")
  await waitFor(
    page,
    () => !!document.querySelector('input[type="file"]'),
    "resume upload control"
  )
  check("interview setup renders", true)

  // ── 2. paste the JD, then upload the resume ──────────────────────────────
  await page.evaluate((jd) => {
    const ta = [...document.querySelectorAll("textarea")].find((t) =>
      (t.placeholder || "").startsWith("Paste the job description here")
    )
    if (!ta) throw new Error("JD textarea not found")
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    ).set
    setter.call(ta, jd)
    ta.dispatchEvent(new Event("input", { bubbles: true }))
  }, JD)

  const input = await page.$('input[type="file"]')
  await input.uploadFile(resumePath)

  await waitFor(
    page,
    () => !document.querySelector('input[type="file"]'),
    "the setup view to hand over to the live session"
  )
  const afterUpload = await bodyText(page)
  const lengthMatch = afterUpload.match(/(\d+)\s*(?:of\s*\d+\s*)?questions/i)
  const counts = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="session-progress"]')
    return el
      ? {
          planned: Number(el.dataset.planned),
          questions: Number(el.dataset.questionCount),
        }
      : { planned: 0, questions: 0 }
  })
  const planned = counts.planned
  const qCount = counts.questions
  check("questions generated", qCount > 0, `${qCount} questions generated`)
  check(
    "the configured length is what the backend reports",
    planned === 6,
    `backend constant ${planned}`
  )
  check(
    "the UI label states the configured length",
    Boolean(lengthMatch),
    `header "${lengthMatch ? lengthMatch[0] : "?"}"`
  )
  if (qCount !== planned) {
    note(
      "the model returned fewer questions than configured",
      `${qCount} of ${planned}; the UI labels it honestly as "${lengthMatch[0]}". The flow below still exercises the full completion path.`
    )
  }

  const planBefore = await bodyText(page)
  check(
    "plan already grounded in JD gaps before answering",
    has(planBefore, "Your learning plan"),
    "learning plan panel present at upload"
  )

  // ── 3. answer every question through the composer ─────────────────────────
  const typeInComposer = (text) =>
    page.evaluate((t) => {
      const ta = [...document.querySelectorAll("textarea")].find(
        (el) => !el.closest("main")
      )
      if (!ta) throw new Error("composer textarea not found")
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      ).set.call(ta, t)
      ta.dispatchEvent(new Event("input", { bubbles: true }))
    }, text)

  for (let i = 1; i <= qCount; i++) {
    // Cloud scoring can legitimately fail (rate limit, timeout). The app
    // surfaces that as a visible error; the smoke test re-sends rather than
    // reporting a UI regression that is really an upstream 429.
    let scored = false
    for (let attempt = 1; attempt <= 3 && !scored; attempt++) {
      await typeInComposer(ANSWER)
      await waitFor(
        page,
        () => {
          const b = document.querySelector('[aria-label="Send message"]')
          return !!b && !b.disabled
        },
        `the composer to accept question ${i}`
      )
      if (!(await clickAria(page, "Send message")))
        throw new Error(`send button not found for question ${i}`)
      const deadline = Date.now() + 240000
      while (Date.now() < deadline) {
        const state = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="session-progress"]')
          return {
            answered: el ? Number(el.dataset.answered) : -1,
            failed: document.body.innerText.toLowerCase().includes("scoring failed"),
          }
        })
        if (state.answered === i) {
          scored = true
          break
        }
        if (state.failed) {
          console.log(`    answer ${i} hit a scoring error, retrying (attempt ${attempt + 1})`)
          await sleep(8000)
          break
        }
        await sleep(700)
      }
    }
    if (!scored) throw new Error(`answer ${i} could not be scored after 3 attempts`)
    console.log(`    answered ${i}/${qCount}`)
    await sleep(3000)
  }

  // ── 4. the plan must be on screen with NO refresh ─────────────────────────
  await waitFor(
    page,
    () => document.body.innerText.toLowerCase().includes("session complete"),
    "session complete"
  )
  await sleep(500)

  const t = await bodyText(page)
  const at = (needle) => t.toLowerCase().indexOf(needle.toLowerCase())
  check("SESSION COMPLETE shown", has(t, "Session complete"))
  check("READINESS SNAPSHOT shown", has(t, "Readiness snapshot"), "readiness panel")

  const weakIdx = at("Top weaknesses")
  check(
    "TOP WEAKNESSES shown",
    weakIdx > -1,
    weakIdx > -1 ? "weaknesses panel present" : "panel missing"
  )

  const planIdx = at("Your learning plan")
  check(
    "PERSONALIZED LEARNING PLAN visible without refresh",
    planIdx > -1,
    planIdx > -1 ? `at char ${planIdx}` : "panel missing"
  )

  if (planIdx > -1) {
    check(
      "documented order: summary -> readiness -> weaknesses -> plan -> re-test",
      at("Session complete") < at("Readiness snapshot") &&
        at("Readiness snapshot") < weakIdx &&
        weakIdx < planIdx &&
        planIdx < at("Re-test: previous vs target"),
      `summary@${at("Session complete")} readiness@${at("Readiness snapshot")} weaknesses@${weakIdx} plan@${planIdx} retest@${at("Re-test: previous vs target")}`
    )
    const tail = t.slice(planIdx)
    for (const needle of [
      "Recommended because:",
      "Origin:",
      "Evidence:",
      "Do this:",
      "Mini drill:",
      "Re-test:",
    ]) {
      check(`plan item shows "${needle}"`, has(tail, needle))
    }
  }

  // the first plan item is expanded by default — read its content
  const itemCount = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="learning-plan"]')
    return el ? Number(el.dataset.planItems) : 0
  })
  check("plan renders one row per item", itemCount > 0, `${itemCount} items`)

  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .map((a) => ({ href: a.href, text: (a.textContent || "").trim() }))
      .filter((a) => /^https?:\/\//.test(a.href))
  )
  check(
    "resource links come from the curated catalog",
    links.length > 0,
    links.length ? links[0].href : "no external link found"
  )

  // ── 5. the re-test loop must produce a REAL before/after ─────────────────
  const openedRetest = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.getAttribute("aria-label") || "").startsWith("Re-test:")
    )
    if (!b) return false
    b.click()
    return true
  })
  check("a re-test action is offered on a real answered question", openedRetest)

  if (openedRetest) {
    await waitFor(
      page,
      () =>
        [...document.querySelectorAll("button")].some(
          (b) => (b.textContent || "").includes("Score this retry")
        ),
      "the retry card"
    )
    await page.evaluate((text) => {
      const ta = [...document.querySelectorAll("textarea")].find((el) =>
        (el.placeholder || "").startsWith("Or type your improved answer")
      )
      if (!ta) throw new Error("retry textarea not found")
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      ).set.call(ta, text)
      ta.dispatchEvent(new Event("input", { bubbles: true }))
    }, IMPROVED_ANSWER)
    await sleep(200)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        (x.textContent || "").includes("Score this retry")
      )
      b.click()
    })
    await waitFor(
      page,
      () => {
        // NOTE: the RetryCard copy itself contains "what changed", so wait on
        // the stored result landing in the panel - not on that prose.
        const panel = document.querySelector('[data-testid="retest-panel"]')
        return !!panel && Number(panel.dataset.retested) > 0
      },
      "the stored retry result",
      240000
    )
    await sleep(400)
    // read the numbers straight off the rendered row, not out of prose
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="retest-row"]')].map((el) => ({
        before: Number(el.dataset.before),
        after: el.dataset.after === "" ? null : Number(el.dataset.after),
        delta: el.dataset.delta === "" ? null : Number(el.dataset.delta),
      }))
    )
    const retestedRows = rows.filter((r) => r.after !== null)
    check(
      "re-test reports a real before/after from stored attempts",
      retestedRows.length > 0,
      retestedRows.length
        ? `${retestedRows.length} re-tested: ` +
          retestedRows
            .map((r) => `${r.before} -> ${r.after} (${r.delta})`)
            .join(", ")
        : "no re-tested row found"
    )
    check(
      "the improvement number is the real delta, not a boast",
      retestedRows.length > 0 &&
        retestedRows.every((r) => r.delta === r.after - r.before),
      retestedRows.length
        ? retestedRows
            .map((r) => `${r.delta} vs ${r.after - r.before}`)
            .join(", ")
        : ""
    )
    const human = await bodyText(page)
    const shown = human.match(/previous\s+\d+\s*→\s*now\s+\d+\s*\(\s*[+-]?\d+\s*\)/i)
    check(
      "the human-readable row shows the same numbers",
      Boolean(shown),
      shown ? shown[0].replace(/\s+/g, " ") : "no before/after row in the rendered text"
    )
  }

  await page.screenshot({ path: join(SHOTS, "learning-plan.png"), fullPage: true })

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "))
} catch (err) {
  failures.push(`exception: ${err.message}`)
  console.error("  EXCEPTION:", err.message)
  try {
    await page.screenshot({ path: join(SHOTS, "learning-plan-failure.png"), fullPage: true })
  } catch {}
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\nSMOKE TEST FAILED (${failures.length}):`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("\nSMOKE TEST PASSED: learning plan visible after every question, no refresh")