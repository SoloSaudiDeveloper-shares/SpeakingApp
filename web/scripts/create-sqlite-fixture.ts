import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from '../src/lib/utils/password';

const index = process.argv.indexOf('--out');
if (index < 0 || !process.argv[index + 1]) throw new Error('--out is required.');
const output = path.resolve(process.argv[index + 1]);
const db = new Database(output);
try {
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, cefr_level TEXT NOT NULL, total_words INTEGER NOT NULL);
    CREATE TABLE students (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_number TEXT NOT NULL, full_name TEXT NOT NULL, class TEXT, cefr_band TEXT NOT NULL, is_active INTEGER NOT NULL, diagnostic_json TEXT, onboarded_at TEXT, tutor_voice TEXT);
    CREATE TABLE user_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, student_id INTEGER, display_name TEXT, is_active INTEGER NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY, token TEXT, user_id INTEGER, expires_at TEXT);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, book_id INTEGER NOT NULL, teacher_notes TEXT);
    CREATE TABLE student_cycles (student_id INTEGER NOT NULL, cycle_id INTEGER NOT NULL, enrolled_at TEXT NOT NULL);
    CREATE TABLE vocabulary_items (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL, word TEXT NOT NULL, arabic_meaning TEXT, phoneme_string TEXT, difficulty_tier INTEGER NOT NULL, unit INTEGER NOT NULL, sort_order INTEGER NOT NULL, sentence_frames TEXT, part_of_speech TEXT, example_sentence TEXT);
    CREATE TABLE practice_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL, vocabulary_item_id INTEGER, task_type TEXT NOT NULL, prompt TEXT NOT NULL, expected_answers TEXT, pass_score REAL NOT NULL);
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO books VALUES (1, 'Fixture Book', 'A1', 1)`).run();
  db.prepare(`INSERT INTO students VALUES (1, 'fixture-learner', 'Fixture Learner', 'Fixture', 'A1', 1, NULL, NULL, NULL)`).run();
  db.prepare(`INSERT INTO students VALUES (2, 'weak-fixture-learner', 'Weak Fixture Learner', 'Fixture', 'A1', 1, NULL, NULL, NULL)`).run();
  db.prepare(`INSERT INTO user_accounts VALUES (1, 'fixture-learner', ?, 'Student', 1, 'Fixture Learner', 1, ?, NULL)`)
    .run(hashPassword('fixture-strong-password'), now);
  db.prepare(`INSERT INTO user_accounts VALUES (2, 'weak-fixture-admin', ?, 'Admin', NULL, 'Weak Fixture Admin', 1, ?, NULL)`)
    .run(hashPassword('admin'), now);
  db.prepare(`INSERT INTO user_accounts VALUES (3, 'weak-fixture-teacher', ?, 'Teacher', NULL, 'Weak Fixture Teacher', 1, ?, NULL)`)
    .run(hashPassword('teacher'), now);
  db.prepare(`INSERT INTO user_accounts VALUES (4, 'weak-fixture-student', ?, 'Student', 2, 'Weak Fixture Student', 1, ?, NULL)`)
    .run(hashPassword('1'), now);
  db.prepare(`INSERT INTO sessions VALUES (1, 'session-that-must-not-migrate', 1, ?)`).run(now);
  db.prepare(`INSERT INTO app_settings VALUES ('groq_api_key', 'configured-provider-value')`).run();
  db.prepare(`INSERT INTO app_settings VALUES ('future_provider_token', 'unknown-secret-value')`).run();
  db.prepare(`INSERT INTO app_settings VALUES ('pass_threshold', '0.6')`).run();
  db.prepare(`INSERT INTO cycles VALUES (1, '2026-07-01', '2026-07-31', 1, NULL)`).run();
  db.prepare(`INSERT INTO student_cycles VALUES (1, 1, ?)`).run(now);
  db.prepare(`INSERT INTO vocabulary_items VALUES (1, 1, 'hello', NULL, NULL, 1, 1, 1, '[]', 'interjection', 'Hello there.')`).run();
  db.prepare(`INSERT INTO practice_tasks VALUES (1, 1, 1, 'ListenRepeat', 'Say hello', '["hello"]', 0.6)`).run();
  console.log(`[fixture] ${output}`);
} finally {
  db.close();
}
