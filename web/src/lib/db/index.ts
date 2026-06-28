import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

// Data directory:
//   - In Electron production: process.env.SPEAKING_LAB_DATA_DIR points at the
//     user's appData folder so the DB survives reinstalls/upgrades.
//   - In dev / web mode: ../data relative to the Next.js project.
const dbDir = process.env.SPEAKING_LAB_DATA_DIR
  ? process.env.SPEAKING_LAB_DATA_DIR
  : path.join(process.cwd(), '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'speakinglab.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create all tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_number TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    class TEXT,
    cefr_band TEXT NOT NULL DEFAULT 'A1',
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cefr_level TEXT NOT NULL DEFAULT 'A1',
    total_words INTEGER NOT NULL DEFAULT 180
  );
  CREATE TABLE IF NOT EXISTS vocabulary_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    arabic_meaning TEXT,
    phoneme_string TEXT,
    difficulty_tier INTEGER NOT NULL DEFAULT 1,
    unit INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    sentence_frames TEXT,
    part_of_speech TEXT,
    example_sentence TEXT
  );
  CREATE TABLE IF NOT EXISTS klp_import_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    file_name TEXT,
    imported_at TEXT NOT NULL,
    imported_by_user_id INTEGER,
    total_concepts INTEGER NOT NULL DEFAULT 0,
    active_question_shapes INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'imported'
  );
  CREATE TABLE IF NOT EXISTS klp_concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES klp_import_sources(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    book TEXT,
    lesson TEXT,
    domain TEXT NOT NULL,
    concept_number TEXT,
    subdivision TEXT,
    base_item TEXT,
    subtype TEXT,
    part_of_speech TEXT,
    definition TEXT,
    dli_classification TEXT,
    primary_skill_type TEXT,
    secondary_skill_type TEXT,
    tertiary_skill_type TEXT,
    quaternary_skill_type TEXT,
    duplicate_in_course TEXT,
    duplicate_in_book TEXT,
    support_status TEXT NOT NULL DEFAULT 'unsupported',
    active_question_count INTEGER NOT NULL DEFAULT 0,
    active_question_shapes_json TEXT NOT NULL DEFAULT '[]',
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS klp_concepts_source_concept_idx
    ON klp_concepts(source_id, concept_id);
  CREATE TABLE IF NOT EXISTS klp_active_question_shapes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES klp_import_sources(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    question_shape TEXT NOT NULL,
    modality TEXT,
    raw_json TEXT NOT NULL DEFAULT '{}'
  );
  DROP INDEX IF EXISTS klp_active_questions_source_question_idx;
  CREATE INDEX IF NOT EXISTS klp_active_questions_source_question_lookup_idx
    ON klp_active_question_shapes(source_id, question_id);
  CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    book_id INTEGER NOT NULL REFERENCES books(id),
    teacher_notes TEXT
  );
  CREATE TABLE IF NOT EXISTS student_cycles (
    student_id INTEGER NOT NULL REFERENCES students(id),
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    enrolled_at TEXT NOT NULL,
    PRIMARY KEY (student_id, cycle_id)
  );
  CREATE TABLE IF NOT EXISTS practice_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    vocabulary_item_id INTEGER REFERENCES vocabulary_items(id),
    task_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    expected_answers TEXT,
    pass_score REAL NOT NULL DEFAULT 0.6
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    book_id INTEGER NOT NULL REFERENCES books(id),
    practice_task_id INTEGER NOT NULL REFERENCES practice_tasks(id),
    timestamp TEXT NOT NULL,
    audio_path TEXT,
    raw_transcript TEXT,
    rescored_transcript TEXT,
    target_match_score REAL NOT NULL DEFAULT 0,
    pronunciation_score REAL NOT NULL DEFAULT 0,
    fluency_score REAL NOT NULL DEFAULT 0,
    completeness_score REAL NOT NULL DEFAULT 0,
    consistency_score REAL NOT NULL DEFAULT 0,
    composite_score REAL NOT NULL DEFAULT 0,
    teacher_override_score REAL,
    teacher_notes TEXT
  );
  CREATE TABLE IF NOT EXISTS speech_reliability_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    user_id INTEGER,
    class_name TEXT,
    event_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    route TEXT NOT NULL,
    practice_stage TEXT,
    scenario_id TEXT,
    practice_task_id INTEGER REFERENCES practice_tasks(id) ON DELETE SET NULL,
    success INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER,
    error_code TEXT,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    no_speech INTEGER NOT NULL DEFAULT 0,
    fallback_used INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS speech_reliability_created_at_idx
    ON speech_reliability_events(created_at);
  CREATE INDEX IF NOT EXISTS speech_reliability_student_idx
    ON speech_reliability_events(student_id);
  CREATE INDEX IF NOT EXISTS speech_reliability_class_idx
    ON speech_reliability_events(class_name);
  CREATE INDEX IF NOT EXISTS speech_reliability_event_type_idx
    ON speech_reliability_events(event_type);
  CREATE TABLE IF NOT EXISTS word_mastery_records (
    student_id INTEGER NOT NULL REFERENCES students(id),
    vocabulary_item_id INTEGER NOT NULL REFERENCES vocabulary_items(id),
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    times_seen INTEGER NOT NULL DEFAULT 0,
    times_spoken INTEGER NOT NULL DEFAULT 0,
    best_score REAL NOT NULL DEFAULT 0,
    latest_score REAL NOT NULL DEFAULT 0,
    mastery_status TEXT NOT NULL DEFAULT 'NotStarted',
    PRIMARY KEY (student_id, vocabulary_item_id, cycle_id)
  );
  CREATE TABLE IF NOT EXISTS user_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Student',
    student_id INTEGER REFERENCES students(id),
    display_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS external_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_account_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS external_identities_provider_subject_idx
    ON external_identities(provider, subject);
  CREATE TABLE IF NOT EXISTS external_sso_launches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    jti TEXT NOT NULL,
    user_account_id INTEGER REFERENCES user_accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS external_sso_launches_provider_jti_idx
    ON external_sso_launches(provider, jti);
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teacher_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER REFERENCES attempts(id),
    student_id INTEGER REFERENCES students(id),
    flag_type TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS custom_practice_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    created_by_user_id INTEGER NOT NULL,
    word_ids TEXT NOT NULL DEFAULT '[]',
    task_types TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stage_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    task_type TEXT NOT NULL,
    unlocked INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS live_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    created_by_user_id INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    task_type TEXT NOT NULL,
    word_ids TEXT NOT NULL DEFAULT '[]',
    class_name TEXT
  );
  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES user_accounts(id),
    widget_config TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS student_xp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    earned_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    xp_reward INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS student_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    badge_id INTEGER NOT NULL REFERENCES badges(id),
    earned_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    date TEXT NOT NULL,
    target_words INTEGER NOT NULL DEFAULT 10,
    completed_words INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS spaced_repetition_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    vocabulary_item_id INTEGER NOT NULL REFERENCES vocabulary_items(id),
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    interval INTEGER NOT NULL DEFAULT 1,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review_date TEXT NOT NULL,
    last_review_date TEXT
  );
  CREATE TABLE IF NOT EXISTS homework_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER NOT NULL REFERENCES cycles(id),
    created_by_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    word_ids TEXT NOT NULL DEFAULT '[]',
    task_types TEXT NOT NULL DEFAULT '[]',
    due_date TEXT NOT NULL,
    class_name TEXT,
    target_type TEXT NOT NULL DEFAULT 'class',
    student_ids_json TEXT NOT NULL DEFAULT '[]',
    klp_ids_json TEXT NOT NULL DEFAULT '[]',
    scenario_ids_json TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'assigned',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS homework_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    homework_id INTEGER NOT NULL REFERENCES homework_assignments(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    completed_at TEXT,
    words_completed INTEGER NOT NULL DEFAULT 0,
    avg_score REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS student_texts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    title TEXT NOT NULL,
    original_text TEXT NOT NULL,
    summary TEXT,
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_practiced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS text_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_text_id INTEGER NOT NULL REFERENCES student_texts(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id),
    spoken_transcript TEXT,
    accuracy_score REAL NOT NULL DEFAULT 0,
    pronunciation_score REAL NOT NULL DEFAULT 0,
    fluency_score REAL NOT NULL DEFAULT 0,
    completeness_score REAL NOT NULL DEFAULT 0,
    weak_words TEXT NOT NULL DEFAULT '[]',
    attempted_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS student_word_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    name TEXT NOT NULL,
    words TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_practiced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS fluency_drill_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    cycle_id INTEGER REFERENCES cycles(id),
    drill_type TEXT NOT NULL,
    topic_id TEXT,
    rounds_json TEXT NOT NULL DEFAULT '[]',
    improvement_score REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scenario_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    scenario_id TEXT NOT NULL,
    transcript_json TEXT NOT NULL DEFAULT '[]',
    criteria_met_json TEXT NOT NULL DEFAULT '[]',
    score REAL NOT NULL DEFAULT 0,
    feedback TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS practice_task_klps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practice_task_id INTEGER NOT NULL REFERENCES practice_tasks(id) ON DELETE CASCADE,
    klp_concept_id INTEGER NOT NULL REFERENCES klp_concepts(id) ON DELETE CASCADE,
    assessment_mode TEXT NOT NULL DEFAULT 'speaking_performance',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS practice_task_klps_task_concept_idx
    ON practice_task_klps(practice_task_id, klp_concept_id);
  CREATE TABLE IF NOT EXISTS klp_generated_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    cefr_level TEXT NOT NULL DEFAULT 'A1',
    icon TEXT NOT NULL DEFAULT 'Drama',
    ai_role TEXT NOT NULL,
    student_goal TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    first_message TEXT NOT NULL,
    success_criteria_json TEXT NOT NULL DEFAULT '[]',
    target_vocabulary_json TEXT NOT NULL DEFAULT '[]',
    min_turns INTEGER NOT NULL DEFAULT 4,
    progression_mode TEXT NOT NULL DEFAULT 'guided',
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'ai_klp',
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    klp_ids_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS scenario_klps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id TEXT NOT NULL,
    klp_concept_id INTEGER NOT NULL REFERENCES klp_concepts(id) ON DELETE CASCADE,
    assessment_mode TEXT NOT NULL DEFAULT 'speaking_performance',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS scenario_klps_scenario_concept_idx
    ON scenario_klps(scenario_id, klp_concept_id);
  CREATE TABLE IF NOT EXISTS attempt_klp_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER REFERENCES attempts(id) ON DELETE CASCADE,
    scenario_attempt_id INTEGER REFERENCES scenario_attempts(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    klp_concept_id INTEGER NOT NULL REFERENCES klp_concepts(id) ON DELETE CASCADE,
    assessment_mode TEXT NOT NULL DEFAULT 'speaking_performance',
    support_status TEXT NOT NULL,
    assessed INTEGER NOT NULL DEFAULT 1,
    success_score_percent INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 1,
    raw_scores_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS student_klp_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    klp_concept_id INTEGER NOT NULL REFERENCES klp_concepts(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    latest_score_percent INTEGER NOT NULL DEFAULT 0,
    last_practiced_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS student_klp_summaries_student_concept_idx
    ON student_klp_summaries(student_id, klp_concept_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS vocabulary_fts USING fts5(
    word, arabic_meaning, content=vocabulary_items, content_rowid=id
  );
`);

/**
 * Idempotent column migrations.
 *
 * `CREATE TABLE IF NOT EXISTS` above only creates MISSING tables — it never
 * alters an existing table. To add a column to a table that already exists in
 * a user's database, we must ALTER it. This helper checks the live columns via
 * PRAGMA and adds any that are missing, so it's safe to run on every startup
 * and on both fresh and existing databases.
 */
function ensureColumn(table: string, column: string, definition: string) {
  try {
    const cols = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (e) {
    console.warn(`[db] Could not ensure column ${table}.${column}:`, e);
  }
}

// Phase 0 additive columns (rich fluency metrics + onboarding/diagnostic)
ensureColumn('attempts', 'metrics_json', 'TEXT');
ensureColumn('students', 'diagnostic_json', 'TEXT');
ensureColumn('students', 'onboarded_at', 'TEXT');
ensureColumn('homework_assignments', 'target_type', "TEXT NOT NULL DEFAULT 'class'");
ensureColumn('homework_assignments', 'student_ids_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('homework_assignments', 'klp_ids_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('homework_assignments', 'scenario_ids_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('homework_assignments', 'source', "TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('homework_assignments', 'status', "TEXT NOT NULL DEFAULT 'assigned'");
ensureColumn('klp_generated_scenarios', 'progression_mode', "TEXT NOT NULL DEFAULT 'guided'");

export const db = drizzle(sqlite, { schema });
export { sqlite };

import { seedDatabase } from './seed';
seedDatabase();
