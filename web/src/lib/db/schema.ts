import { pgTable, text, integer, doublePrecision, boolean, date, timestamp, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';

// PostgreSQL stores structured values as jsonb. The application currently
// consumes these columns as JSON strings, so this codec preserves the public
// data-layer contract while gaining native jsonb validation and indexing.
const jsonbText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'jsonb';
  },
  toDriver(value) {
    // node-postgres treats JavaScript arrays as PostgreSQL arrays. Sending
    // validated JSON text avoids producing array literals such as {"word"}
    // for jsonb parameters.
    return JSON.stringify(JSON.parse(value));
  },
  fromDriver(value) {
    return JSON.stringify(value);
  },
});

// Students
export const students = pgTable('students', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  uniqueNumber: text('unique_number').notNull().unique(),
  fullName: text('full_name').notNull(),
  class: text('class'),
  cefrBand: text('cefr_band').notNull().default('A1'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  // Additive (Phase 0): placement diagnostic result + onboarding flag
  diagnosticJson: jsonbText('diagnostic_json'),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true, mode: 'string' }),
});

// Books
export const books = pgTable('books', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  title: text('title').notNull(),
  cefrLevel: text('cefr_level').notNull().default('A1'),
  totalWords: integer('total_words').notNull().default(180),
});

// VocabularyItems
export const vocabularyItems = pgTable('vocabulary_items', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  word: text('word').notNull(),
  arabicMeaning: text('arabic_meaning'),
  phonemeString: text('phoneme_string'),
  difficultyTier: integer('difficulty_tier').notNull().default(1),
  unit: integer('unit').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  sentenceFrames: jsonbText('sentence_frames'),
  partOfSpeech: text('part_of_speech'),
  exampleSentence: text('example_sentence'),
});

// KLP curriculum import sources (ALC/DLI, IELTS later, or custom).
export const klpImportSources = pgTable('klp_import_sources', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  fileName: text('file_name'),
  importedAt: timestamp('imported_at', { withTimezone: true, mode: 'string' }).notNull(),
  importedByUserId: integer('imported_by_user_id'),
  totalConcepts: integer('total_concepts').notNull().default(0),
  activeQuestionShapes: integer('active_question_shapes').notNull().default(0),
  warningsJson: jsonbText('warnings_json').notNull().default('[]'),
  status: text('status').notNull().default('imported'),
});

// Imported KLP concepts. Support status controls whether the app may claim
// speaking evidence or only use a KLP as prompt/curriculum context.
export const klpConcepts = pgTable('klp_concepts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  sourceId: integer('source_id').notNull().references(() => klpImportSources.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull(),
  book: text('book'),
  lesson: text('lesson'),
  domain: text('domain').notNull(),
  conceptNumber: text('concept_number'),
  subdivision: text('subdivision'),
  baseItem: text('base_item'),
  subtype: text('subtype'),
  partOfSpeech: text('part_of_speech'),
  definition: text('definition'),
  dliClassification: text('dli_classification'),
  primarySkillType: text('primary_skill_type'),
  secondarySkillType: text('secondary_skill_type'),
  tertiarySkillType: text('tertiary_skill_type'),
  quaternarySkillType: text('quaternary_skill_type'),
  duplicateInCourse: text('duplicate_in_course'),
  duplicateInBook: text('duplicate_in_book'),
  supportStatus: text('support_status').notNull().default('unsupported'),
  activeQuestionCount: integer('active_question_count').notNull().default(0),
  activeQuestionShapesJson: jsonbText('active_question_shapes_json').notNull().default('[]'),
  rawJson: jsonbText('raw_json').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  sourceConceptIdx: uniqueIndex('klp_concepts_source_concept_idx').on(table.sourceId, table.conceptId),
}));

export const klpActiveQuestionShapes = pgTable('klp_active_question_shapes', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  sourceId: integer('source_id').notNull().references(() => klpImportSources.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull(),
  conceptId: text('concept_id').notNull(),
  questionShape: text('question_shape').notNull(),
  modality: text('modality'),
  rawJson: jsonbText('raw_json').notNull().default('{}'),
}, (table) => ({
  sourceQuestionIdx: index('klp_active_questions_source_question_lookup_idx').on(table.sourceId, table.questionId),
}));

// Cycles
export const cycles = pgTable('cycles', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  bookId: integer('book_id').notNull().references(() => books.id),
  teacherNotes: text('teacher_notes'),
});

// StudentCycles (junction)
export const studentCycles = pgTable('student_cycles', {
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// PracticeTasks
export const practiceTasks = pgTable('practice_tasks', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  bookId: integer('book_id').notNull().references(() => books.id),
  vocabularyItemId: integer('vocabulary_item_id').references(() => vocabularyItems.id),
  taskType: text('task_type').notNull(),
  prompt: text('prompt').notNull(),
  expectedAnswers: jsonbText('expected_answers'),
  passScore: doublePrecision('pass_score').notNull().default(0.6),
});

// Attempts
export const attempts = pgTable('attempts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  clientSubmissionId: text('client_submission_id'),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  bookId: integer('book_id').notNull().references(() => books.id),
  practiceTaskId: integer('practice_task_id').notNull().references(() => practiceTasks.id),
  timestamp: timestamp('timestamp', { withTimezone: true, mode: 'string' }).notNull(),
  audioPath: text('audio_path'),
  rawTranscript: text('raw_transcript'),
  rescoredTranscript: text('rescored_transcript'),
  targetMatchScore: doublePrecision('target_match_score').notNull().default(0),
  pronunciationScore: doublePrecision('pronunciation_score').notNull().default(0),
  fluencyScore: doublePrecision('fluency_score').notNull().default(0),
  completenessScore: doublePrecision('completeness_score').notNull().default(0),
  consistencyScore: doublePrecision('consistency_score').notNull().default(0),
  compositeScore: doublePrecision('composite_score').notNull().default(0),
  teacherOverrideScore: doublePrecision('teacher_override_score'),
  teacherNotes: text('teacher_notes'),
  // Additive (Phase 0): rich fluency metrics JSON (also persists audio duration)
  metricsJson: jsonbText('metrics_json'),
}, (table) => ({
  studentSubmissionIdx: uniqueIndex('attempts_student_submission_idx')
    .on(table.studentId, table.clientSubmissionId),
}));

// Sanitized speech pipeline telemetry. This stores operational reliability
// signals only; never store raw audio, raw transcripts, keys, or provider bodies.
export const speechReliabilityEvents = pgTable('speech_reliability_events', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'set null' }),
  userId: integer('user_id'),
  className: text('class_name'),
  eventType: text('event_type').notNull(), // stt | pronunciation | recording | tts
  provider: text('provider').notNull(),
  route: text('route').notNull(),
  practiceStage: text('practice_stage'),
  scenarioId: text('scenario_id'),
  practiceTaskId: integer('practice_task_id').references(() => practiceTasks.id, { onDelete: 'set null' }),
  success: boolean('success').notNull().default(false),
  statusCode: integer('status_code'),
  errorCode: text('error_code'),
  latencyMs: integer('latency_ms').notNull().default(0),
  noSpeech: boolean('no_speech').notNull().default(false),
  fallbackUsed: boolean('fallback_used').notNull().default(false),
  metadataJson: jsonbText('metadata_json').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  createdAtIdx: index('speech_reliability_created_at_idx').on(table.createdAt),
  studentIdx: index('speech_reliability_student_idx').on(table.studentId),
  classIdx: index('speech_reliability_class_idx').on(table.className),
  eventTypeIdx: index('speech_reliability_event_type_idx').on(table.eventType),
}));

// WordMasteryRecords
export const wordMasteryRecords = pgTable('word_mastery_records', {
  studentId: integer('student_id').notNull().references(() => students.id),
  vocabularyItemId: integer('vocabulary_item_id').notNull().references(() => vocabularyItems.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  timesSeen: integer('times_seen').notNull().default(0),
  timesSpoken: integer('times_spoken').notNull().default(0),
  bestScore: doublePrecision('best_score').notNull().default(0),
  latestScore: doublePrecision('latest_score').notNull().default(0),
  masteryStatus: text('mastery_status').notNull().default('NotStarted'),
});

// UserAccounts
export const userAccounts = pgTable('user_accounts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('Student'),
  studentId: integer('student_id').references(() => students.id),
  displayName: text('display_name'),
  isActive: boolean('is_active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
});

// Sessions
export const sessions = pgTable('sessions', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// External portal identity mapping for signed SSO launches.
export const externalIdentities = pgTable('external_identities', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  userAccountId: integer('user_account_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
}, (table) => ({
  providerSubjectIdx: uniqueIndex('external_identities_provider_subject_idx').on(table.provider, table.subject),
}));

// Short-lived SSO launch replay protection by provider + jti.
export const externalSsoLaunches = pgTable('external_sso_launches', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  provider: text('provider').notNull(),
  jti: text('jti').notNull(),
  userAccountId: integer('user_account_id').references(() => userAccounts.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  providerJtiIdx: uniqueIndex('external_sso_launches_provider_jti_idx').on(table.provider, table.jti),
}));

// AppSettings
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Local development-only encrypted secret persistence. Production reads and
// writes provider credentials through Azure Key Vault.
export const appSecrets = pgTable('app_secrets', {
  key: text('key').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// Organization-level paid TTS quota counters. Reservations are performed with
// a single conditional UPSERT so concurrent replicas cannot exceed a cap.
export const ttsProviderUsage = pgTable('tts_provider_usage', {
  provider: text('provider').notNull(),
  periodMonth: text('period_month').notNull(),
  characters: integer('characters').notNull().default(0),
  requestCount: integer('request_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  providerMonthIdx: uniqueIndex('tts_provider_usage_provider_month_idx')
    .on(table.provider, table.periodMonth),
}));

// Database-backed minute windows keep learner rate limits consistent when
// Container Apps scales beyond one web replica.
export const ttsRateLimitWindows = pgTable('tts_rate_limit_windows', {
  userId: integer('user_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'string' }).notNull(),
  requestCount: integer('request_count').notNull().default(0),
}, (table) => ({
  userProviderWindowIdx: uniqueIndex('tts_rate_limit_user_provider_window_idx')
    .on(table.userId, table.provider, table.windowStartedAt),
}));

// Shared fixed-window counters for unauthenticated abuse controls. Subjects
// are application-keyed HMACs, so raw IP addresses, origins, and usernames are
// not persisted.
export const securityRateLimitWindows = pgTable('security_rate_limit_windows', {
  scope: text('scope').notNull(),
  subjectHash: text('subject_hash').notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'string' }).notNull(),
  requestCount: integer('request_count').notNull().default(0),
}, (table) => ({
  scopeSubjectWindowIdx: uniqueIndex('security_rate_limit_scope_subject_window_idx')
    .on(table.scope, table.subjectHash, table.windowStartedAt),
}));

// Per-user daily resource budgets are stored in PostgreSQL so multiple web
// replicas share a single authoritative limit.
export const userResourceUsage = pgTable('user_resource_usage', {
  userId: integer('user_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),
  periodDay: date('period_day', { mode: 'string' }).notNull(),
  units: integer('units').notNull().default(0),
  requestCount: integer('request_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  userResourceDayIdx: uniqueIndex('user_resource_usage_user_resource_day_idx')
    .on(table.userId, table.resource, table.periodDay),
}));

export const organizationResourceUsage = pgTable('organization_resource_usage', {
  resource: text('resource').notNull(),
  periodDay: date('period_day', { mode: 'string' }).notNull(),
  units: integer('units').notNull().default(0),
  requestCount: integer('request_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  resourceDayIdx: uniqueIndex('organization_resource_usage_resource_day_idx')
    .on(table.resource, table.periodDay),
}));

// TeacherFlags
export const teacherFlags = pgTable('teacher_flags', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  attemptId: integer('attempt_id').references(() => attempts.id),
  studentId: integer('student_id').references(() => students.id),
  flagType: text('flag_type').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
});

// CustomPracticeSets
export const customPracticeSets = pgTable('custom_practice_sets', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  createdByUserId: integer('created_by_user_id').notNull(),
  wordIds: jsonbText('word_ids').notNull().default('[]'),
  taskTypes: jsonbText('task_types').notNull().default('[]'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// StageOverrides
export const stageOverrides = pgTable('stage_overrides', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  taskType: text('task_type').notNull(),
  unlocked: boolean('unlocked').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// LiveSessions
export const liveSessions = pgTable('live_sessions', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  createdByUserId: integer('created_by_user_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'string' }),
  taskType: text('task_type').notNull(),
  wordIds: jsonbText('word_ids').notNull().default('[]'),
  className: text('class_name'),
});

// DashboardWidgets
export const dashboardWidgets = pgTable('dashboard_widgets', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  userId: integer('user_id').notNull().references(() => userAccounts.id),
  widgetConfig: jsonbText('widget_config').notNull().default('[]'),
  version: integer('version').notNull().default(1),
  activeTab: text('active_tab').notNull().default('practice'),
  collapsedSectionsJson: jsonbText('collapsed_sections_json').notNull().default('[]'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
});

// Gamification
export const studentXp = pgTable('student_xp', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(), // 'practice_attempt', 'word_mastered', 'streak_bonus', 'badge_earned'
  earnedAt: timestamp('earned_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const badges = pgTable('badges', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  code: text('code').notNull().unique(), // 'first_word', '10_words', '50_words', 'streak_3', 'streak_7', 'perfect_score', etc.
  name: text('name').notNull(),
  description: text('description').notNull(),
  icon: text('icon').notNull(), // lucide icon name
  xpReward: integer('xp_reward').notNull().default(0),
});

export const studentBadges = pgTable('student_badges', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  badgeId: integer('badge_id').notNull().references(() => badges.id),
  earnedAt: timestamp('earned_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const dailyGoals = pgTable('daily_goals', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  date: date('date', { mode: 'string' }).notNull(), // YYYY-MM-DD
  targetWords: integer('target_words').notNull().default(10),
  completedWords: integer('completed_words').notNull().default(0),
  completed: boolean('completed').notNull().default(false),
});

// Spaced Repetition
export const spacedRepetitionQueue = pgTable('spaced_repetition_queue', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  vocabularyItemId: integer('vocabulary_item_id').notNull().references(() => vocabularyItems.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  interval: integer('interval').notNull().default(1), // days until next review
  easeFactor: doublePrecision('ease_factor').notNull().default(2.5), // SM-2 ease factor
  repetitions: integer('repetitions').notNull().default(0),
  nextReviewDate: date('next_review_date', { mode: 'string' }).notNull(), // YYYY-MM-DD
  lastReviewDate: date('last_review_date', { mode: 'string' }),
});

// Homework assignments
export const homeworkAssignments = pgTable('homework_assignments', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  createdByUserId: integer('created_by_user_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  wordIds: jsonbText('word_ids').notNull().default('[]'), // JSON array
  taskTypes: jsonbText('task_types').notNull().default('[]'), // JSON array
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  className: text('class_name'), // target class
  targetType: text('target_type').notNull().default('class'), // class | cycle | student
  studentIdsJson: jsonbText('student_ids_json').notNull().default('[]'),
  klpIdsJson: jsonbText('klp_ids_json').notNull().default('[]'),
  scenarioIdsJson: jsonbText('scenario_ids_json').notNull().default('[]'),
  source: text('source').notNull().default('manual'), // manual | klp
  status: text('status').notNull().default('assigned'), // assigned | archived
  pathConfigJson: jsonbText('path_config_json'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const homeworkPathProgress = pgTable('homework_path_progress', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  homeworkId: integer('homework_id').notNull().references(() => homeworkAssignments.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  stageKey: text('stage_key').notNull(),
  status: text('status').notNull().default('locked'),
  completedItemsJson: jsonbText('completed_items_json').notNull().default('[]'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  assignmentStudentStageIdx: uniqueIndex('homework_path_progress_assignment_student_stage_idx')
    .on(table.homeworkId, table.studentId, table.stageKey),
}));

export const homeworkSubmissions = pgTable('homework_submissions', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  homeworkId: integer('homework_id').notNull().references(() => homeworkAssignments.id),
  studentId: integer('student_id').notNull().references(() => students.id),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  wordsCompleted: integer('words_completed').notNull().default(0),
  avgScore: doublePrecision('avg_score').notNull().default(0),
});

// Student text library
export const studentTexts = pgTable('student_texts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  title: text('title').notNull(),
  originalText: text('original_text').notNull(),
  summary: text('summary'),
  wordCount: integer('word_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true, mode: 'string' }),
});

// Text practice attempts
export const textAttempts = pgTable('text_attempts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentTextId: integer('student_text_id').notNull().references(() => studentTexts.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id),
  spokenTranscript: text('spoken_transcript'),
  accuracyScore: doublePrecision('accuracy_score').notNull().default(0),
  pronunciationScore: doublePrecision('pronunciation_score').notNull().default(0),
  fluencyScore: doublePrecision('fluency_score').notNull().default(0),
  completenessScore: doublePrecision('completeness_score').notNull().default(0),
  weakWords: jsonbText('weak_words').notNull().default('[]'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true, mode: 'string' }).notNull(),
  durationSeconds: doublePrecision('duration_seconds').notNull().default(0),
});

// Student word lists (custom lists of weak words)
export const studentWordLists = pgTable('student_word_lists', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  name: text('name').notNull(),
  words: jsonbText('words').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true, mode: 'string' }),
});

// Fluency drill sessions (4/3/2 monologue + shadowing) — Phase 2
export const fluencyDrillSessions = pgTable('fluency_drill_sessions', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').references(() => cycles.id),
  drillType: text('drill_type').notNull(), // 'monologue' | 'shadowing'
  topicId: text('topic_id'),
  roundsJson: jsonbText('rounds_json').notNull().default('[]'),
  improvementScore: doublePrecision('improvement_score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// Scenario role-play attempts — Phase 3
export const scenarioAttempts = pgTable('scenario_attempts', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id),
  scenarioId: text('scenario_id').notNull(),
  transcriptJson: jsonbText('transcript_json').notNull().default('[]'),
  criteriaMetJson: jsonbText('criteria_met_json').notNull().default('[]'),
  score: doublePrecision('score').notNull().default(0),
  feedback: text('feedback'),
  sessionId: text('session_id'),
  learnerTurns: integer('learner_turns').notNull().default(0),
  completionReason: text('completion_reason'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex('scenario_attempts_session_idx').on(table.sessionId),
}));

export const practiceTaskKlps = pgTable('practice_task_klps', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  practiceTaskId: integer('practice_task_id').notNull().references(() => practiceTasks.id, { onDelete: 'cascade' }),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  assessmentMode: text('assessment_mode').notNull().default('speaking_performance'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  taskConceptIdx: uniqueIndex('practice_task_klps_task_concept_idx').on(table.practiceTaskId, table.klpConceptId),
}));

export const klpGeneratedScenarios = pgTable('klp_generated_scenarios', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  scenarioId: text('scenario_id').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  cefrLevel: text('cefr_level').notNull().default('A1'),
  icon: text('icon').notNull().default('Drama'),
  aiRole: text('ai_role').notNull(),
  studentGoal: text('student_goal').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  firstMessage: text('first_message').notNull(),
  successCriteriaJson: jsonbText('success_criteria_json').notNull().default('[]'),
  targetVocabularyJson: jsonbText('target_vocabulary_json').notNull().default('[]'),
  minTurns: integer('min_turns').notNull().default(4),
  maxTurns: integer('max_turns').notNull().default(8),
  progressionMode: text('progression_mode').notNull().default('guided'),
  status: text('status').notNull().default('draft'),
  source: text('source').notNull().default('ai_klp'),
  createdByUserId: integer('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
  klpIdsJson: jsonbText('klp_ids_json').notNull().default('[]'),
});

export const scenarioKlps = pgTable('scenario_klps', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  scenarioId: text('scenario_id').notNull(),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  assessmentMode: text('assessment_mode').notNull().default('speaking_performance'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  scenarioConceptIdx: uniqueIndex('scenario_klps_scenario_concept_idx').on(table.scenarioId, table.klpConceptId),
}));

export const attemptKlpResults = pgTable('attempt_klp_results', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  attemptId: integer('attempt_id').references(() => attempts.id, { onDelete: 'cascade' }),
  scenarioAttemptId: integer('scenario_attempt_id').references(() => scenarioAttempts.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  assessmentMode: text('assessment_mode').notNull().default('speaking_performance'),
  supportStatus: text('support_status').notNull(),
  assessed: boolean('assessed').notNull().default(true),
  successScorePercent: integer('success_score_percent').notNull().default(0),
  passed: boolean('passed').notNull().default(false),
  confidence: doublePrecision('confidence').notNull().default(1),
  rawScoresJson: jsonbText('raw_scores_json').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const studentKlpSummaries = pgTable('student_klp_summaries', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  successes: integer('successes').notNull().default(0),
  latestScorePercent: integer('latest_score_percent').notNull().default(0),
  lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true, mode: 'string' }),
}, (table) => ({
  studentConceptIdx: uniqueIndex('student_klp_summaries_student_concept_idx').on(table.studentId, table.klpConceptId),
}));

export const xapiOutbox = pgTable('xapi_outbox', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  statementId: text('statement_id').notNull().unique(),
  attemptKlpResultId: integer('attempt_klp_result_id').notNull().references(() => attemptKlpResults.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  actorSubject: text('actor_subject').notNull(),
  verb: text('verb').notNull(),
  statementJson: jsonbText('statement_json').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'string' }),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
  lastError: text('last_error'),
  responseStatus: integer('response_status'),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
  lockOwner: text('lock_owner'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => ({
  statusNextAttemptIdx: index('xapi_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  resultIdx: index('xapi_outbox_result_idx').on(table.attemptKlpResultId),
}));
