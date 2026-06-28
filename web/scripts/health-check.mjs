// Comprehensive health check: hits every page route and API endpoint as both
// admin and student, flags any 500s or unexpected failures.
//
//   node scripts/health-check.mjs
//
// A page/endpoint "passes" if it returns a non-5xx status. Auth-gated routes
// returning 401/403 for the wrong role are EXPECTED (noted, not failed).

const BASE = "http://localhost:3000"

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  const setCookie = res.headers.get("set-cookie") || ""
  const m = setCookie.match(/session-token=([^;]+)/)
  return m ? m[1] : null
}

async function hit(path, cookie, method = "GET", body = null) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: `session-token=${cookie}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    })
    return res.status
  } catch (e) {
    return `ERR:${e.message.substring(0, 40)}`
  }
}

// ── Page routes (rendered HTML; should never 500) ──────────────────
const PAGES = [
  "/", "/register", "/dashboard", "/change-password", "/history",
  "/practice", "/practice/conversation", "/practice/history", "/practice/hub",
  "/practice/fluency", "/practice/fluency/monologue", "/practice/fluency/shadowing",
  "/onboarding/diagnostic",
  "/practice/texts", "/practice/texts/1", "/practice/texts/lists", "/practice/word/1",
  "/teacher", "/teacher/monitor", "/teacher/review", "/teacher/student/1", "/teacher/attempt/1",
  "/reports", "/reports/class", "/reports/audio", "/reports/progress/1",
  "/admin/students", "/admin/books", "/admin/books/1", "/admin/cycles", "/admin/cycles/1",
  "/admin/practice-sets", "/admin/stages", "/admin/live-session",
  "/admin/models", "/admin/models/ai", "/admin/models/stt", "/admin/models/tts", "/admin/status",
  "/settings/appearance", "/settings/mic-test",
]

// ── API GET endpoints ──────────────────────────────────────────────
const API_GET = [
  "/api/auth/me",
  "/api/settings",
  "/api/students", "/api/students/1", "/api/students/1/progress",
  "/api/books", "/api/books/1", "/api/books/1/vocabulary",
  "/api/cycles", "/api/cycles/1",
  "/api/practice", "/api/practice/leaderboard", "/api/practice/review-queue", "/api/practice/word/1",
  "/api/ai/status", "/api/ai/models",
  "/api/onboarding", "/api/practice/fluency",
  "/api/admin/curriculum-templates",
  "/api/admin/classes", "/api/admin/stage-config", "/api/admin/stage-config/student/1",
  "/api/teacher/class-monitor", "/api/teacher/attempt/1",
  "/api/text-practice", "/api/text-practice/1", "/api/text-practice/word-lists",
  "/api/gamification",
  "/api/homework",
  "/api/live-sessions", "/api/live-sessions/1",
  "/api/vocabulary/1",
]

function fmt(status) {
  if (typeof status === "string") return `\x1b[31m${status}\x1b[0m`
  if (status >= 500) return `\x1b[31m${status}\x1b[0m`
  if (status === 401 || status === 403) return `\x1b[33m${status}\x1b[0m`
  if (status >= 200 && status < 400) return `\x1b[32m${status}\x1b[0m`
  return `\x1b[33m${status}\x1b[0m`
}

async function main() {
  console.log("Logging in...")
  const admin = await login("admin", "admin")
  const student = await login("1", "1")
  console.log(`  admin token: ${admin ? "OK" : "FAILED"}`)
  console.log(`  student token: ${student ? "OK" : "FAILED"}`)

  const failures = []

  console.log("\n=== PAGE ROUTES (as admin) ===")
  for (const p of PAGES) {
    const s = await hit(p, admin)
    const bad = typeof s === "string" || s >= 500
    if (bad) failures.push(`PAGE admin ${p} → ${s}`)
    console.log(`  ${fmt(s)}  ${p}`)
  }

  console.log("\n=== PAGE ROUTES (as student) ===")
  for (const p of PAGES) {
    const s = await hit(p, student)
    const bad = typeof s === "string" || s >= 500
    if (bad) failures.push(`PAGE student ${p} → ${s}`)
    console.log(`  ${fmt(s)}  ${p}`)
  }

  console.log("\n=== API GET (as admin) ===")
  for (const p of API_GET) {
    const s = await hit(p, admin)
    const bad = typeof s === "string" || s >= 500
    if (bad) failures.push(`API admin ${p} → ${s}`)
    console.log(`  ${fmt(s)}  ${p}`)
  }

  console.log("\n=== API GET (as student) ===")
  for (const p of API_GET) {
    const s = await hit(p, student)
    const bad = typeof s === "string" || s >= 500
    if (bad) failures.push(`API student ${p} → ${s}`)
    console.log(`  ${fmt(s)}  ${p}`)
  }

  console.log("\n" + "=".repeat(60))
  if (failures.length === 0) {
    console.log("\x1b[32m✓ No 5xx errors or crashes across all routes.\x1b[0m")
  } else {
    console.log(`\x1b[31m✗ ${failures.length} failure(s):\x1b[0m`)
    failures.forEach((f) => console.log("  " + f))
  }
  console.log("=".repeat(60))
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
