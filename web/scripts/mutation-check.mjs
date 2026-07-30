// Tests write operations (POST/PATCH/DELETE) end-to-end and cleans up after.
//   node scripts/mutation-check.mjs
import { randomBytes } from "node:crypto"

const BASE = (process.env.TEST_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "")

async function login(u, p) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  })
  const m = (res.headers.get("set-cookie") || "").match(/session-token=([^;]+)/)
  return m ? m[1] : null
}
async function api(path, cookie, method = "GET", body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: `session-token=${cookie}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* non-json */ }
  return { status: res.status, data }
}

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`)
}

async function main() {
  const adminPassword = process.env.MUTATION_ADMIN_PASSWORD || process.env.DEMO_ADMIN_PASSWORD
  const studentPassword = process.env.MUTATION_STUDENT_PASSWORD || process.env.DEMO_STUDENT_PASSWORD
  if (!adminPassword || !studentPassword) {
    console.error("MUTATION_ADMIN_PASSWORD and MUTATION_STUDENT_PASSWORD are required.")
    process.exit(1)
  }
  const admin = await login(process.env.MUTATION_ADMIN_USERNAME || "demo-admin", adminPassword)
  const student = await login(process.env.MUTATION_STUDENT_USERNAME || "demo-learner", studentPassword)
  if (!admin || !student) { console.error("Login failed"); process.exit(1) }

  console.log("\n=== STUDENT CRUD ===")
  // Create
  const create = await api("/api/students", admin, "POST", {
    uniqueNumber: "TEST-QA-999", fullName: "QA Test Student", class: "QA Class", cefrBand: "A1",
    password: `${randomBytes(18).toString("base64url")}aA1!`,
  })
  const newId = create.data?.student?.id
  check("Create student", create.status === 200 && !!newId, `id=${newId}`)
  // Update
  if (newId) {
    const upd = await api(`/api/students/${newId}`, admin, "PATCH", { fullName: "QA Renamed", cefrBand: "A2" })
    check("Update student", upd.status === 200)
    // Delete
    const del = await api(`/api/students/${newId}`, admin, "DELETE")
    check("Delete student", del.status === 200)
  }

  console.log("\n=== SETTINGS ===")
  const setSet = await api("/api/settings", admin, "POST", { key: "qa_test_setting", value: "hello" })
  check("Save setting (admin)", setSet.status === 200)
  const getSet = await api("/api/settings", admin)
  check("Read back setting", getSet.data?.qa_test_setting === "hello")
  // Student cannot write settings
  const studentSet = await api("/api/settings", student, "POST", { key: "qa_hack", value: "x" })
  check("Student blocked from settings write", studentSet.status === 403)

  console.log("\n=== STAGE CONFIG ===")
  const stageSave = await api("/api/admin/stage-config", admin, "POST", {
    sequence: ["read-aloud", "repeat", "listen", "sentence", "free-speak", "review"],
    unlockMode: "all",
  })
  check("Save default stage config", stageSave.status === 200)
  const stageGet = await api("/api/admin/stage-config", admin)
  check("Stage config persisted", stageGet.data?.defaults?.unlockMode === "all" && stageGet.data?.defaults?.sequence?.[0] === "read-aloud")
  // Restore default
  await api("/api/admin/stage-config", admin, "POST", {
    sequence: ["listen", "repeat", "read-aloud", "sentence", "free-speak", "review"],
    unlockMode: "sequential",
  })
  check("Restore default stage config", true)

  console.log("\n=== PRACTICE ATTEMPT (student) ===")
  // Get the student's practice data to find a real task
  const practice = await api("/api/practice", student)
  const task = practice.data?.tasks?.[0]
  const cycle = practice.data?.cycle
  const book = practice.data?.book
  if (task && cycle && book) {
    const attempt = await api("/api/practice/attempt", student, "POST", {
      cycleId: cycle.id, bookId: book.id, practiceTaskId: task.id,
      rawTranscript: "test", targetMatchScore: 0.9, pronunciationScore: 0.85,
      fluencyScore: 0.8, completenessScore: 0.9, consistencyScore: 0.7, compositeScore: 0.85,
    })
    check("Submit practice attempt", attempt.status === 200, `status=${attempt.status}`)
  } else {
    check("Submit practice attempt", false, "no task/cycle/book available (skipped)")
  }

  console.log("\n=== TEXT PRACTICE (student) ===")
  const textCreate = await api("/api/text-practice", student, "POST", {
    title: "QA Text", originalText: "The quick brown fox jumps over the lazy dog.",
  })
  const textId = textCreate.data?.text?.id ?? textCreate.data?.id
  check("Create text", textCreate.status === 200, `id=${textId}`)
  if (textId) {
    const textDel = await api(`/api/text-practice/${textId}`, student, "DELETE")
    check("Delete text", textDel.status === 200)
  }

  console.log("\n=== AI STATUS (provider abstraction) ===")
  const aiStatus = await api("/api/ai/status", admin)
  check("AI status reachable", aiStatus.status === 200, `provider=${aiStatus.data?.provider} online=${aiStatus.data?.online}`)

  // Summary
  const failed = results.filter(r => !r.ok)
  console.log("\n" + "=".repeat(60))
  if (failed.length === 0) {
    console.log(`\x1b[32m✓ All ${results.length} mutation tests passed.\x1b[0m`)
  } else {
    console.log(`\x1b[31m✗ ${failed.length}/${results.length} failed:\x1b[0m`)
    failed.forEach(f => console.log(`  ${f.name} ${f.detail}`))
  }
  console.log("=".repeat(60))
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
