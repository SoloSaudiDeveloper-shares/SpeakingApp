// Populate "Class A" with a realistic roster of ~11 students (12 total incl. the
// seeded Ahmed Ali), enroll them in the current cycle, and generate believable
// mixed practice history: attempts (with fluency metrics), word mastery, XP,
// daily goals, and a few teacher flags. Idempotent-ish: skips students that
// already exist by uniqueNumber.
//
//   node scripts/seed-class-a.mjs

import Database from "better-sqlite3"
import crypto from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, "..", "..", "data", "speakinglab.db")

function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(pw, salt, 100_000, 64, "sha512")
  return `${salt.toString("base64")}.${hash.toString("base64")}`
}

// Deterministic-ish RNG so re-runs look similar (no Math.random ban here — plain node)
let seed = 12345
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
function pick(arr) { return arr[Math.floor(rand() * arr.length)] }
function between(a, b) { return a + rand() * (b - a) }

const ROSTER = [
  { num: "1001", name: "Layla Hassan", cefr: "A1", skill: 0.25 },
  { num: "1002", name: "Omar Khalil", cefr: "A1", skill: 0.35 },
  { num: "1003", name: "Fatima Nasser", cefr: "A1", skill: 0.30 },
  { num: "1004", name: "Yousef Mansour", cefr: "A2", skill: 0.48 },
  { num: "1005", name: "Noor Abdullah", cefr: "A2", skill: 0.55 },
  { num: "1006", name: "Khaled Ibrahim", cefr: "A2", skill: 0.50 },
  { num: "1007", name: "Maryam Saleh", cefr: "B1", skill: 0.68 },
  { num: "1008", name: "Ali Rahman", cefr: "B1", skill: 0.72 },
  { num: "1009", name: "Huda Karim", cefr: "B1", skill: 0.65 },
  { num: "1010", name: "Tariq Aziz", cefr: "B2", skill: 0.85 },
  { num: "1011", name: "Salma Farouk", cefr: "B2", skill: 0.88 },
]

const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")

const now = () => new Date().toISOString()
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString()
const dateAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)

// Resolve the active cycle + its book + vocab + tasks
const cycle = db.prepare("SELECT * FROM cycles ORDER BY id DESC LIMIT 1").get()
if (!cycle) { console.error("No cycle found — seed the app first."); process.exit(1) }
const book = db.prepare("SELECT * FROM books WHERE id = ?").get(cycle.book_id)
const vocab = db.prepare("SELECT * FROM vocabulary_items WHERE book_id = ?").all(cycle.book_id)
const tasks = db.prepare("SELECT * FROM practice_tasks WHERE book_id = ?").all(cycle.book_id)
console.log(`Cycle #${cycle.id} · ${book.title} · ${vocab.length} words · ${tasks.length} tasks`)

const insStudent = db.prepare("INSERT INTO students (unique_number, full_name, class, cefr_band, is_active) VALUES (?,?,?,?,1)")
const insUser = db.prepare("INSERT INTO user_accounts (username, password_hash, role, student_id, display_name, is_active, created_at) VALUES (?,?,?,?,?,1,?)")
const insEnroll = db.prepare("INSERT OR IGNORE INTO student_cycles (student_id, cycle_id, enrolled_at) VALUES (?,?,?)")
const insAttempt = db.prepare(`INSERT INTO attempts (student_id, cycle_id, book_id, practice_task_id, timestamp, raw_transcript, target_match_score, pronunciation_score, fluency_score, completeness_score, consistency_score, composite_score, metrics_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const insMastery = db.prepare(`INSERT OR REPLACE INTO word_mastery_records (student_id, vocabulary_item_id, cycle_id, times_seen, times_spoken, best_score, latest_score, mastery_status) VALUES (?,?,?,?,?,?,?,?)`)
const insXp = db.prepare("INSERT INTO student_xp (student_id, amount, reason, earned_at) VALUES (?,?,?,?)")
const insGoal = db.prepare("INSERT INTO daily_goals (student_id, date, target_words, completed_words, completed) VALUES (?,?,?,?,?)")
const insFlag = db.prepare("INSERT INTO teacher_flags (attempt_id, student_id, flag_type, notes, created_at) VALUES (?,?,?,?,?)")

const tx = db.transaction(() => {
  let created = 0
  for (const r of ROSTER) {
    const existing = db.prepare("SELECT id FROM students WHERE unique_number = ?").get(r.num)
    if (existing) { console.log(`  skip ${r.name} (exists)`); continue }

    const sid = insStudent.run(r.num, r.name, "Class A", r.cefr).lastInsertRowid
    insUser.run(r.num, hashPassword(r.num), "Student", sid, r.name, now())
    insEnroll.run(sid, cycle.id, now())

    // How many words this student has worked through (better students do more)
    const wordsAttempted = Math.round(between(0.3, 1.0) * r.skill * vocab.length) + Math.round(between(2, 6))
    const subset = vocab.slice(0, Math.min(vocab.length, Math.max(4, wordsAttempted)))

    let xpTotal = 0
    let attemptCount = 0
    for (const v of subset) {
      const task = tasks.find(t => t.vocabulary_item_id === v.id)
      if (!task) continue
      // 1-3 attempts per word, scores trending toward the student's skill
      const tries = 1 + Math.floor(rand() * 3)
      let best = 0, latest = 0
      for (let k = 0; k < tries; k++) {
        const base = Math.max(0, Math.min(1, r.skill + between(-0.2, 0.2)))
        const target = Math.max(0, Math.min(1, base + between(-0.1, 0.1)))
        const pron = Math.max(0, Math.min(1, base + between(-0.15, 0.1)))
        const flu = Math.max(0, Math.min(1, base + between(-0.2, 0.15)))
        const comp = Math.max(0, Math.min(1, base + between(-0.1, 0.1)))
        const cons = Math.max(0, Math.min(1, base + between(-0.1, 0.1)))
        const composite = target * 0.35 + pron * 0.25 + flu * 0.2 + comp * 0.1 + cons * 0.1
        best = Math.max(best, composite); latest = composite
        const wpm = Math.round(between(40, 60) + r.skill * 90)
        const metrics = JSON.stringify({
          schemaVersion: 1, wordCount: 1, audioDurationSeconds: Math.round(between(1, 3) * 10) / 10,
          speechRateWpm: wpm, articulationRateWpm: wpm + 20, pauseCount: Math.round(between(0, 3)),
          pausePerMin: Math.round(between(0, 25) * 10) / 10, totalPauseSeconds: 0,
          meanLengthOfRun: Math.round(between(1, 6) * 10) / 10, fluencyIndex: Math.round(flu * 1000) / 1000,
        })
        const ts = daysAgo(Math.floor(between(0, 12)))
        const aid = insAttempt.run(sid, cycle.id, book.id, task.id, ts, v.word, target, pron, flu, comp, cons, composite, metrics).lastInsertRowid
        attemptCount++
        xpTotal += 10 + Math.round(composite * 20)
        // Occasionally flag a low-scoring attempt for teacher review
        if (composite < 0.35 && rand() < 0.25) {
          insFlag.run(aid, sid, "low_score", "Auto-flagged: low composite score, needs review.", ts)
        }
      }
      const status = best >= 0.85 ? "Mastered" : best >= 0.5 ? "Developing" : "Attempted"
      insMastery.run(sid, v.id, cycle.id, tries, tries, best, latest, status)
    }

    // XP + a few daily goals (streak-ish)
    if (xpTotal > 0) insXp.run(sid, xpTotal, "practice_attempt", now())
    const streakDays = Math.round(between(0, 6) * r.skill) + 1
    for (let d = 0; d < streakDays; d++) {
      const done = Math.round(between(3, 12))
      insGoal.run(sid, dateAgo(d), 10, done, done >= 10 ? 1 : 0)
    }

    created++
    console.log(`  + ${r.name} (${r.cefr}) — ${attemptCount} attempts, ${subset.length} words, ${xpTotal} XP`)
  }
  return created
})

const n = tx()
console.log(`\nDone. Created ${n} new students in Class A.`)

// Summary
const classA = db.prepare("SELECT COUNT(*) c FROM students WHERE class = 'Class A'").get()
const totalAttempts = db.prepare("SELECT COUNT(*) c FROM attempts").get()
console.log(`Class A now has ${classA.c} students; ${totalAttempts.c} total attempts in the DB.`)
db.close()
