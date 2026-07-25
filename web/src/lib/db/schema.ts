import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Students
export const students = sqliteTable('students', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uniqueNumber: text('unique_number').notNull().unique(),
  fullName: text('full_name').notNull(),
  class: text('class'),
  cefrBand: text('cefr_band').notNull().default('A1'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  notes: text('notes'),
  // Additive (Phase 0): placement diagnostic result + onboarding flag
  diagnosticJson: text('diagnostic_json'),
  onboardedAt: text('onboarded_at'),
});

// Books
export const books = sqliteTable('books', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  cefrLevel: text('cefr_level').notNull().default('A1'),
  totalWords: integer('total_words').notNull().default(180),
});

// VocabularyItems
export const vocabularyItems = sqliteTable('vocabulary_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: integer('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  word: text('word').notNull(),
  arabicMeaning: text('arabic_meaning'),
  phonemeString: text('phoneme_string'),
  difficultyTier: integer('difficulty_tier').notNull().default(1),
  unit: integer('unit').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  sentenceFrames: text('sentence_frames'),
  partOfSpeech: text('part_of_speech'),
  exampleSentence: text('example_sentence'),
});

// KLP curriculum import sources (ALC/DLI, IELTS later, or custom).
export const klpImportSources = sqliteTable('klp_import_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  fileName: text('file_name'),
  importedAt: text('imported_at').notNull(),
  importedByUserId: integer('imported_by_user_id'),
  totalConcepts: integer('total_concepts').notNull().default(0),
  activeQuestionShapes: integer('active_question_shapes').notNull().default(0),
  warningsJson: text('warnings_json').notNull().default('[]'),
  status: text('status').notNull().default('imported'),
});

// Imported KLP concepts. Support status controls whether the app may claim
// speaking evidence or only use a KLP as prompt/curriculum context.
export const klpConcepts = sqliteTable('klp_concepts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  activeQuestionShapesJson: text('active_question_shapes_json').notNull().default('[]'),
  rawJson: text('raw_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  sourceConceptIdx: uniqueIndex('klp_concepts_source_concept_idx').on(table.sourceId, table.conceptId),
}));

export const klpActiveQuestionShapes = sqliteTable('klp_active_question_shapes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => klpImportSources.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull(),
  conceptId: text('concept_id').notNull(),
  questionShape: text('question_shape').notNull(),
  modality: text('modality'),
  rawJson: text('raw_json').notNull().default('{}'),
}, (table) => ({
  sourceQuestionIdx: index('klp_active_questions_source_question_lookup_idx').on(table.sourceId, table.questionId),
}));

// Cycles
export const cycles = sqliteTable('cycles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  bookId: integer('book_id').notNull().references(() => books.id),
  teacherNotes: text('teacher_notes'),
});

// StudentCycles (junction)
export const studentCycles = sqliteTable('student_cycles', {
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  enrolledAt: text('enrolled_at').notNull(),
});

// PracticeTasks
export const practiceTasks = sqliteTable('practice_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: integer('book_id').notNull().references(() => books.id),
  vocabularyItemId: integer('vocabulary_item_id').references(() => vocabularyItems.id),
  taskType: text('task_type').notNull(),
  prompt: text('prompt').notNull(),
  expectedAnswers: text('expected_answers'),
  passScore: real('pass_score').notNull().default(0.6),
});

// Attempts
export const attempts = sqliteTable('attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  bookId: integer('book_id').notNull().references(() => books.id),
  practiceTaskId: integer('practice_task_id').notNull().references(() => practiceTasks.id),
  timestamp: text('timestamp').notNull(),
  audioPath: text('audio_path'),
  rawTranscript: text('raw_transcript'),
  rescoredTranscript: text('rescored_transcript'),
  targetMatchScore: real('target_match_score').notNull().default(0),
  pronunciationScore: real('pronunciation_score').notNull().default(0),
  fluencyScore: real('fluency_score').notNull().default(0),
  completenessScore: real('completeness_score').notNull().default(0),
  consistencyScore: real('consistency_score').notNull().default(0),
  compositeScore: real('composite_score').notNull().default(0),
  teacherOverrideScore: real('teacher_override_score'),
  teacherNotes: text('teacher_notes'),
  // Additive (Phase 0): rich fluency metrics JSON (also persists audio duration)
  metricsJson: text('metrics_json'),
});

// Sanitized speech pipeline telemetry. This stores operational reliability
// signals only; never store raw audio, raw transcripts, keys, or provider bodies.
export const speechReliabilityEvents = sqliteTable('speech_reliability_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'set null' }),
  userId: integer('user_id'),
  className: text('class_name'),
  eventType: text('event_type').notNull(), // stt | pronunciation | recording
  provider: text('provider').notNull(),
  route: text('route').notNull(),
  practiceStage: text('practice_stage'),
  scenarioId: text('scenario_id'),
  practiceTaskId: integer('practice_task_id').references(() => practiceTasks.id, { onDelete: 'set null' }),
  success: integer('success', { mode: 'boolean' }).notNull().default(false),
  statusCode: integer('status_code'),
  errorCode: text('error_code'),
  latencyMs: integer('latency_ms').notNull().default(0),
  noSpeech: integer('no_speech', { mode: 'boolean' }).notNull().default(false),
  fallbackUsed: integer('fallback_used', { mode: 'boolean' }).notNull().default(false),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  createdAtIdx: index('speech_reliability_created_at_idx').on(table.createdAt),
  studentIdx: index('speech_reliability_student_idx').on(table.studentId),
  classIdx: index('speech_reliability_class_idx').on(table.className),
  eventTypeIdx: index('speech_reliability_event_type_idx').on(table.eventType),
}));

// WordMasteryRecords
export const wordMasteryRecords = sqliteTable('word_mastery_records', {
  studentId: integer('student_id').notNull().references(() => students.id),
  vocabularyItemId: integer('vocabulary_item_id').notNull().references(() => vocabularyItems.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  timesSeen: integer('times_seen').notNull().default(0),
  timesSpoken: integer('times_spoken').notNull().default(0),
  bestScore: real('best_score').notNull().default(0),
  latestScore: real('latest_score').notNull().default(0),
  masteryStatus: text('mastery_status').notNull().default('NotStarted'),
});

// UserAccounts
export const userAccounts = sqliteTable('user_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('Student'),
  studentId: integer('student_id').references(() => students.id),
  displayName: text('display_name'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at'),
});

// Sessions
export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  userId: integer('user_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
});

// External portal identity mapping for signed SSO launches.
export const externalIdentities = sqliteTable('external_identities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  userAccountId: integer('user_account_id').notNull().references(() => userAccounts.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastLoginAt: text('last_login_at'),
}, (table) => ({
  providerSubjectIdx: uniqueIndex('external_identities_provider_subject_idx').on(table.provider, table.subject),
}));

// Short-lived SSO launch replay protection by provider + jti.
export const externalSsoLaunches = sqliteTable('external_sso_launches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),
  jti: text('jti').notNull(),
  userAccountId: integer('user_account_id').references(() => userAccounts.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, (table) => ({
  providerJtiIdx: uniqueIndex('external_sso_launches_provider_jti_idx').on(table.provider, table.jti),
}));

// AppSettings
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// TeacherFlags
export const teacherFlags = sqliteTable('teacher_flags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attemptId: integer('attempt_id').references(() => attempts.id),
  studentId: integer('student_id').references(() => students.id),
  flagType: text('flag_type').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});

// CustomPracticeSets
export const customPracticeSets = sqliteTable('custom_practice_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  createdByUserId: integer('created_by_user_id').notNull(),
  wordIds: text('word_ids').notNull().default('[]'),
  taskTypes: text('task_types').notNull().default('[]'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// StageOverrides
export const stageOverrides = sqliteTable('stage_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  taskType: text('task_type').notNull(),
  unlocked: integer('unlocked', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// LiveSessions
export const liveSessions = sqliteTable('live_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  createdByUserId: integer('created_by_user_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  taskType: text('task_type').notNull(),
  wordIds: text('word_ids').notNull().default('[]'),
  className: text('class_name'),
});

// DashboardWidgets
export const dashboardWidgets = sqliteTable('dashboard_widgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => userAccounts.id),
  widgetConfig: text('widget_config').notNull().default('[]'),
  version: integer('version').notNull().default(1),
  activeTab: text('active_tab').notNull().default('practice'),
  collapsedSectionsJson: text('collapsed_sections_json').notNull().default('[]'),
  updatedAt: text('updated_at'),
});

// Gamification
export const studentXp = sqliteTable('student_xp', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(), // 'practice_attempt', 'word_mastered', 'streak_bonus', 'badge_earned'
  earnedAt: text('earned_at').notNull(),
});

export const badges = sqliteTable('badges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(), // 'first_word', '10_words', '50_words', 'streak_3', 'streak_7', 'perfect_score', etc.
  name: text('name').notNull(),
  description: text('description').notNull(),
  icon: text('icon').notNull(), // lucide icon name
  xpReward: integer('xp_reward').notNull().default(0),
});

export const studentBadges = sqliteTable('student_badges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  badgeId: integer('badge_id').notNull().references(() => badges.id),
  earnedAt: text('earned_at').notNull(),
});

export const dailyGoals = sqliteTable('daily_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  date: text('date').notNull(), // YYYY-MM-DD
  targetWords: integer('target_words').notNull().default(10),
  completedWords: integer('completed_words').notNull().default(0),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
});

// Spaced Repetition
export const spacedRepetitionQueue = sqliteTable('spaced_repetition_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  vocabularyItemId: integer('vocabulary_item_id').notNull().references(() => vocabularyItems.id),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  interval: integer('interval').notNull().default(1), // days until next review
  easeFactor: real('ease_factor').notNull().default(2.5), // SM-2 ease factor
  repetitions: integer('repetitions').notNull().default(0),
  nextReviewDate: text('next_review_date').notNull(), // YYYY-MM-DD
  lastReviewDate: text('last_review_date'),
});

// Homework assignments
export const homeworkAssignments = sqliteTable('homework_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cycleId: integer('cycle_id').notNull().references(() => cycles.id),
  createdByUserId: integer('created_by_user_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  wordIds: text('word_ids').notNull().default('[]'), // JSON array
  taskTypes: text('task_types').notNull().default('[]'), // JSON array
  dueDate: text('due_date').notNull(),
  className: text('class_name'), // target class
  targetType: text('target_type').notNull().default('class'), // class | cycle | student
  studentIdsJson: text('student_ids_json').notNull().default('[]'),
  klpIdsJson: text('klp_ids_json').notNull().default('[]'),
  scenarioIdsJson: text('scenario_ids_json').notNull().default('[]'),
  source: text('source').notNull().default('manual'), // manual | klp
  status: text('status').notNull().default('assigned'), // assigned | archived
  pathConfigJson: text('path_config_json'),
  createdAt: text('created_at').notNull(),
});

export const homeworkPathProgress = sqliteTable('homework_path_progress', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  homeworkId: integer('homework_id').notNull().references(() => homeworkAssignments.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  stageKey: text('stage_key').notNull(),
  status: text('status').notNull().default('locked'),
  completedItemsJson: text('completed_items_json').notNull().default('[]'),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  assignmentStudentStageIdx: uniqueIndex('homework_path_progress_assignment_student_stage_idx')
    .on(table.homeworkId, table.studentId, table.stageKey),
}));

export const homeworkSubmissions = sqliteTable('homework_submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  homeworkId: integer('homework_id').notNull().references(() => homeworkAssignments.id),
  studentId: integer('student_id').notNull().references(() => students.id),
  completedAt: text('completed_at'),
  wordsCompleted: integer('words_completed').notNull().default(0),
  avgScore: real('avg_score').notNull().default(0),
});

// Student text library
export const studentTexts = sqliteTable('student_texts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  title: text('title').notNull(),
  originalText: text('original_text').notNull(),
  summary: text('summary'),
  wordCount: integer('word_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  lastPracticedAt: text('last_practiced_at'),
});

// Text practice attempts
export const textAttempts = sqliteTable('text_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentTextId: integer('student_text_id').notNull().references(() => studentTexts.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id),
  spokenTranscript: text('spoken_transcript'),
  accuracyScore: real('accuracy_score').notNull().default(0),
  pronunciationScore: real('pronunciation_score').notNull().default(0),
  fluencyScore: real('fluency_score').notNull().default(0),
  completenessScore: real('completeness_score').notNull().default(0),
  weakWords: text('weak_words').notNull().default('[]'),
  attemptedAt: text('attempted_at').notNull(),
  durationSeconds: real('duration_seconds').notNull().default(0),
});

// Student word lists (custom lists of weak words)
export const studentWordLists = sqliteTable('student_word_lists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  name: text('name').notNull(),
  words: text('words').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  lastPracticedAt: text('last_practiced_at'),
});

// Fluency drill sessions (4/3/2 monologue + shadowing) — Phase 2
export const fluencyDrillSessions = sqliteTable('fluency_drill_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  cycleId: integer('cycle_id').references(() => cycles.id),
  drillType: text('drill_type').notNull(), // 'monologue' | 'shadowing'
  topicId: text('topic_id'),
  roundsJson: text('rounds_json').notNull().default('[]'),
  improvementScore: real('improvement_score').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// Scenario role-play attempts — Phase 3
export const scenarioAttempts = sqliteTable('scenario_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id),
  scenarioId: text('scenario_id').notNull(),
  transcriptJson: text('transcript_json').notNull().default('[]'),
  criteriaMetJson: text('criteria_met_json').notNull().default('[]'),
  score: real('score').notNull().default(0),
  feedback: text('feedback'),
  sessionId: text('session_id'),
  learnerTurns: integer('learner_turns').notNull().default(0),
  completionReason: text('completion_reason'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  sessionIdx: uniqueIndex('scenario_attempts_session_idx').on(table.sessionId),
}));

export const practiceTaskKlps = sqliteTable('practice_task_klps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  practiceTaskId: integer('practice_task_id').notNull().references(() => practiceTasks.id, { onDelete: 'cascade' }),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  assessmentMode: text('assessment_mode').notNull().default('speaking_performance'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  taskConceptIdx: uniqueIndex('practice_task_klps_task_concept_idx').on(table.practiceTaskId, table.klpConceptId),
}));

export const klpGeneratedScenarios = sqliteTable('klp_generated_scenarios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scenarioId: text('scenario_id').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  cefrLevel: text('cefr_level').notNull().default('A1'),
  icon: text('icon').notNull().default('Drama'),
  aiRole: text('ai_role').notNull(),
  studentGoal: text('student_goal').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  firstMessage: text('first_message').notNull(),
  successCriteriaJson: text('success_criteria_json').notNull().default('[]'),
  targetVocabularyJson: text('target_vocabulary_json').notNull().default('[]'),
  minTurns: integer('min_turns').notNull().default(4),
  maxTurns: integer('max_turns').notNull().default(8),
  progressionMode: text('progression_mode').notNull().default('guided'),
  status: text('status').notNull().default('draft'),
  source: text('source').notNull().default('ai_klp'),
  createdByUserId: integer('created_by_user_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  publishedAt: text('published_at'),
  klpIdsJson: text('klp_ids_json').notNull().default('[]'),
});

export const scenarioKlps = sqliteTable('scenario_klps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scenarioId: text('scenario_id').notNull(),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  assessmentMode: text('assessment_mode').notNull().default('speaking_performance'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  scenarioConceptIdx: uniqueIndex('scenario_klps_scenario_concept_idx').on(table.scenarioId, table.klpConceptId),
}));

export const attemptKlpResults = sqliteTable('attempt_klp_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attemptId: integer('attempt_id').references(() => attempts.id, { onDelete: 'cascade' }),
  scenarioAttemptId: integer('scenario_attempt_id').references(() => scenarioAttempts.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  assessmentMode: text('assessment_mode').notNull().default('speaking_performance'),
  supportStatus: text('support_status').notNull(),
  assessed: integer('assessed', { mode: 'boolean' }).notNull().default(true),
  successScorePercent: integer('success_score_percent').notNull().default(0),
  passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
  confidence: real('confidence').notNull().default(1),
  rawScoresJson: text('raw_scores_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
});

export const studentKlpSummaries = sqliteTable('student_klp_summaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  klpConceptId: integer('klp_concept_id').notNull().references(() => klpConcepts.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  successes: integer('successes').notNull().default(0),
  latestScorePercent: integer('latest_score_percent').notNull().default(0),
  lastPracticedAt: text('last_practiced_at'),
}, (table) => ({
  studentConceptIdx: uniqueIndex('student_klp_summaries_student_concept_idx').on(table.studentId, table.klpConceptId),
}));

export const xapiOutbox = sqliteTable('xapi_outbox', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  statementId: text('statement_id').notNull().unique(),
  attemptKlpResultId: integer('attempt_klp_result_id').notNull().references(() => attemptKlpResults.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  actorSubject: text('actor_subject').notNull(),
  verb: text('verb').notNull(),
  statementJson: text('statement_json').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at').notNull(),
  lastAttemptAt: text('last_attempt_at'),
  sentAt: text('sent_at'),
  lastError: text('last_error'),
  responseStatus: integer('response_status'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  statusNextAttemptIdx: index('xapi_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  resultIdx: index('xapi_outbox_result_idx').on(table.attemptKlpResultId),
}));
