import { db } from './index';
import {
  appSettings,
  attemptKlpResults,
  attempts,
  badges,
  students,
  books,
  customPracticeSets,
  cycles,
  dailyGoals,
  fluencyDrillSessions,
  homeworkAssignments,
  homeworkSubmissions,
  klpActiveQuestionShapes,
  klpConcepts,
  klpGeneratedScenarios,
  klpImportSources,
  liveSessions,
  practiceTaskKlps,
  practiceTasks,
  scenarioAttempts,
  scenarioKlps,
  spacedRepetitionQueue,
  speechReliabilityEvents,
  studentBadges,
  studentCycles,
  studentKlpSummaries,
  studentTexts,
  studentWordLists,
  studentXp,
  teacherFlags,
  textAttempts,
  userAccounts,
  vocabularyItems,
  wordMasteryRecords,
} from './schema';
import { eq, count } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../utils/password';

const SEED_WORDS: Array<{
  word: string;
  arabic: string;
  pos: string;
  example: string;
}> = [
  { word: 'water', arabic: '\u0645\u0627\u0621', pos: 'noun', example: 'I drink water every day.' },
  { word: 'book', arabic: '\u0643\u062a\u0627\u0628', pos: 'noun', example: 'I read a book.' },
  { word: 'pen', arabic: '\u0642\u0644\u0645', pos: 'noun', example: 'I write with a pen.' },
  { word: 'door', arabic: '\u0628\u0627\u0628', pos: 'noun', example: 'Please open the door.' },
  { word: 'chair', arabic: '\u0643\u0631\u0633\u064a', pos: 'noun', example: 'Sit on the chair.' },
  { word: 'table', arabic: '\u0637\u0627\u0648\u0644\u0629', pos: 'noun', example: 'The book is on the table.' },
  { word: 'teacher', arabic: '\u0645\u0639\u0644\u0645', pos: 'noun', example: 'The teacher is kind.' },
  { word: 'student', arabic: '\u0637\u0627\u0644\u0628', pos: 'noun', example: 'The student is reading.' },
  { word: 'school', arabic: '\u0645\u062f\u0631\u0633\u0629', pos: 'noun', example: 'I go to school.' },
  { word: 'house', arabic: '\u0628\u064a\u062a', pos: 'noun', example: 'This is my house.' },
  { word: 'big', arabic: '\u0643\u0628\u064a\u0631', pos: 'adjective', example: 'The house is big.' },
  { word: 'small', arabic: '\u0635\u063a\u064a\u0631', pos: 'adjective', example: 'The pen is small.' },
  { word: 'good', arabic: '\u062c\u064a\u062f', pos: 'adjective', example: 'This is a good book.' },
  { word: 'new', arabic: '\u062c\u062f\u064a\u062f', pos: 'adjective', example: 'I have a new pen.' },
  { word: 'old', arabic: '\u0642\u062f\u064a\u0645', pos: 'adjective', example: 'The school is old.' },
  { word: 'eat', arabic: '\u064a\u0623\u0643\u0644', pos: 'verb', example: 'I eat breakfast.' },
  { word: 'drink', arabic: '\u064a\u0634\u0631\u0628', pos: 'verb', example: 'I drink milk.' },
  { word: 'read', arabic: '\u064a\u0642\u0631\u0623', pos: 'verb', example: 'I read every day.' },
  { word: 'write', arabic: '\u064a\u0643\u062a\u0628', pos: 'verb', example: 'I write my name.' },
  { word: 'go', arabic: '\u064a\u0630\u0647\u0628', pos: 'verb', example: 'I go to school.' },
  { word: 'come', arabic: '\u064a\u0623\u062a\u064a', pos: 'verb', example: 'Come here please.' },
  { word: 'help', arabic: '\u064a\u0633\u0627\u0639\u062f', pos: 'verb', example: 'Can you help me?' },
  { word: 'need', arabic: '\u064a\u062d\u062a\u0627\u062c', pos: 'verb', example: 'I need a pen.' },
  { word: 'want', arabic: '\u064a\u0631\u064a\u062f', pos: 'verb', example: 'I want water.' },
  { word: 'see', arabic: '\u064a\u0631\u0649', pos: 'verb', example: 'I can see the teacher.' },
  { word: 'hello', arabic: '\u0645\u0631\u062d\u0628\u0627', pos: 'interjection', example: 'Hello, how are you?' },
  { word: 'please', arabic: '\u0645\u0646 \u0641\u0636\u0644\u0643', pos: 'adverb', example: 'Please sit down.' },
  { word: 'thank you', arabic: '\u0634\u0643\u0631\u0627', pos: 'interjection', example: 'Thank you very much.' },
  { word: 'yes', arabic: '\u0646\u0639\u0645', pos: 'adverb', example: 'Yes, I understand.' },
  { word: 'no', arabic: '\u0644\u0627', pos: 'adverb', example: 'No, thank you.' },
];

export async function seedDatabase(): Promise<void> {
  if (process.env.DEMO_DATA_ENABLED === 'true') {
    seedSanitizedDemoDatabase();
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    seedProductionBootstrapAdmin();
    return;
  }

  // Check if data already exists
  const bookCount = db.select({ value: count() }).from(books).get();
  if (bookCount && bookCount.value > 0) {
    ensureDemoLoginAccounts();
    console.log('Database already seeded, skipping.');
    return;
  }

  console.log('Seeding database...');
  const now = new Date().toISOString();

  // Create book
  const [book] = db
    .insert(books)
    .values({
      title: 'Everyday English - Level 1',
      cefrLevel: 'A1',
      totalWords: 30,
    })
    .returning()
    .all();

  // Create vocabulary items
  const vocabRows = SEED_WORDS.map((w, i) => ({
    bookId: book.id,
    word: w.word,
    arabicMeaning: w.arabic,
    partOfSpeech: w.pos,
    exampleSentence: w.example,
    difficultyTier: 1,
    unit: 1,
    sortOrder: i,
  }));

  const insertedVocab = db.insert(vocabularyItems).values(vocabRows).returning().all();

  // Create ListenRepeat practice tasks for each word
  const taskRows = insertedVocab.map((v) => ({
    bookId: book.id,
    vocabularyItemId: v.id,
    taskType: 'ListenRepeat',
    prompt: `Listen and repeat: "${v.word}"`,
    expectedAnswers: JSON.stringify([v.word]),
    passScore: 0.6,
  }));

  db.insert(practiceTasks).values(taskRows).run();

  // Create cycle (today to +14 days)
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 14);

  const [cycle] = db
    .insert(cycles)
    .values({
      startDate: today.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      bookId: book.id,
    })
    .returning()
    .all();

  // Create student
  const [student] = db
    .insert(students)
    .values({
      uniqueNumber: '1',
      fullName: 'Ahmed Ali',
      class: 'Class A',
      cefrBand: 'A1',
      isActive: true,
    })
    .returning()
    .all();

  // Enroll student in cycle
  db.insert(studentCycles)
    .values({
      studentId: student.id,
      cycleId: cycle.id,
      enrolledAt: now,
    })
    .run();

  // Create user accounts
  const adminHash = hashPassword('admin');
  const teacherHash = hashPassword('teacher');
  const studentHash = hashPassword('1');

  db.insert(userAccounts)
    .values([
      {
        username: 'admin',
        passwordHash: adminHash,
        role: 'Admin',
        displayName: 'Administrator',
        isActive: true,
        createdAt: now,
      },
      {
        username: 'teacher',
        passwordHash: teacherHash,
        role: 'Teacher',
        displayName: 'Teacher',
        isActive: true,
        createdAt: now,
      },
      {
        username: '1',
        passwordHash: studentHash,
        role: 'Student',
        studentId: student.id,
        displayName: 'Ahmed Ali',
        isActive: true,
        createdAt: now,
      },
    ])
    .run();

  // Seed default app settings
  db.insert(appSettings)
    .values([
      { key: 'ollama_url', value: 'http://localhost:11434' },
      { key: 'ollama_enabled', value: 'false' },
      { key: 'ollama_model', value: 'llama3' },
      { key: 'scoring_weights_pronunciation', value: '0.35' },
      { key: 'scoring_weights_fluency', value: '0.25' },
      { key: 'scoring_weights_completeness', value: '0.25' },
      { key: 'scoring_weights_consistency', value: '0.15' },
      { key: 'pass_threshold', value: '0.6' },
      { key: 'mastery_threshold', value: '0.85' },
      { key: 'max_attempts_per_task', value: '5' },
      { key: 'ai_conversation_scenario_scoring_mode', value: 'live' },
    ])
    .run();

  // Seed badges
  const existingBadges = db.select().from(badges).all();
  if (existingBadges.length === 0) {
    const badgeList = [
      { code: 'first_word', name: 'First Word', description: 'Practice your first word', icon: 'Star', xpReward: 10 },
      { code: '10_words', name: 'Word Explorer', description: 'Practice 10 different words', icon: 'Map', xpReward: 50 },
      { code: '50_words', name: 'Word Master', description: 'Practice 50 different words', icon: 'Crown', xpReward: 200 },
      { code: '100_words', name: 'Vocabulary Champion', description: 'Practice 100 different words', icon: 'Trophy', xpReward: 500 },
      { code: 'streak_3', name: '3-Day Streak', description: 'Practice 3 days in a row', icon: 'Flame', xpReward: 30 },
      { code: 'streak_7', name: 'Weekly Warrior', description: 'Practice 7 days in a row', icon: 'Flame', xpReward: 100 },
      { code: 'streak_30', name: 'Monthly Master', description: 'Practice 30 days in a row', icon: 'Flame', xpReward: 500 },
      { code: 'perfect_score', name: 'Perfect!', description: 'Get a perfect score on any word', icon: 'Sparkles', xpReward: 25 },
      { code: 'speed_demon', name: 'Speed Demon', description: 'Complete 10 words in under 5 minutes', icon: 'Zap', xpReward: 75 },
      { code: 'mastered_10', name: 'Decade Master', description: 'Master 10 words', icon: 'Award', xpReward: 100 },
      { code: 'all_stages', name: 'Stage Cleared', description: 'Complete all 6 practice stages', icon: 'Flag', xpReward: 300 },
    ];
    for (const b of badgeList) {
      db.insert(badges).values(b).run();
    }
  }

  console.log('Database seeded successfully.');
}

function envRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set when DEMO_DATA_ENABLED=true.`);
  }
  return value;
}

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function dateDaysFromNow(days: number): string {
  return isoDaysFromNow(days).slice(0, 10);
}

function upsertSetting(key: string, value: string) {
  const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (existing) db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).run();
  else db.insert(appSettings).values({ key, value }).run();
}

function seedBadgeCatalog() {
  const existingBadges = db.select().from(badges).all();
  if (existingBadges.length > 0) return existingBadges;

  const badgeList = [
    { code: 'first_word', name: 'First Word', description: 'Practice your first word', icon: 'Star', xpReward: 10 },
    { code: '10_words', name: 'Word Explorer', description: 'Practice 10 different words', icon: 'Map', xpReward: 50 },
    { code: 'streak_3', name: '3-Day Streak', description: 'Practice 3 days in a row', icon: 'Flame', xpReward: 30 },
    { code: 'perfect_score', name: 'Perfect!', description: 'Get a perfect score on any word', icon: 'Sparkles', xpReward: 25 },
    { code: 'all_stages', name: 'Stage Cleared', description: 'Complete all 6 practice stages', icon: 'Flag', xpReward: 300 },
  ];
  db.insert(badges).values(badgeList).run();
  return db.select().from(badges).all();
}

function seedProductionBootstrapAdmin(): void {
  const existingUsers = db.select({ value: count() }).from(userAccounts).get();
  if (existingUsers && existingUsers.value > 0) return;

  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!password) {
    console.warn('[seed] Production database is empty and BOOTSTRAP_ADMIN_PASSWORD is not set. No public default accounts were created.');
    return;
  }

  const now = new Date().toISOString();
  db.insert(userAccounts)
    .values({
      username: process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || 'admin',
      passwordHash: hashPassword(password),
      role: 'Admin',
      displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || 'Administrator',
      isActive: true,
      createdAt: now,
    })
    .run();

  upsertSetting('ai_conversation_scenario_scoring_mode', 'live');
  upsertSetting('klp_features_enabled', 'false');
  console.log('[seed] Production bootstrap admin created from environment variables.');
}

function seedSanitizedDemoDatabase(): void {
  const marker = db.select().from(appSettings).where(eq(appSettings.key, 'demo_data_seeded_at')).get();
  if (marker) {
    syncSanitizedDemoLoginPasswords();
    console.log('[seed] Sanitized demo data already present, skipping.');
    return;
  }

  const bookCount = db.select({ value: count() }).from(books).get();
  if (bookCount && bookCount.value > 0) {
    console.log('[seed] Existing data found; sanitized demo seed will not overwrite it.');
    return;
  }

  const adminPassword = envRequired('DEMO_ADMIN_PASSWORD');
  const teacherPassword = envRequired('DEMO_TEACHER_PASSWORD');
  const studentPassword = envRequired('DEMO_STUDENT_PASSWORD');
  const now = new Date().toISOString();

  const [book] = db.insert(books).values({
    title: 'Demo ALC Speaking Path - Book 1',
    cefrLevel: 'A1',
    totalWords: 12,
  }).returning().all();

  const demoWords = [
    { word: 'water', arabic: '\u0645\u0627\u0621', pos: 'noun', example: 'I want water.' },
    { word: 'want', arabic: '\u064a\u0631\u064a\u062f', pos: 'verb', example: 'I want a book.' },
    { word: 'am', arabic: '\u0623\u0643\u0648\u0646', pos: 'verb', example: 'I am ready.' },
    { word: 'ready', arabic: '\u062c\u0627\u0647\u0632', pos: 'adjective', example: 'I am ready for class.' },
    { word: 'thank you', arabic: '\u0634\u0643\u0631\u0627', pos: 'phrase', example: 'Thank you for your help.' },
    { word: 'how much', arabic: '\u0628\u0643\u0645', pos: 'phrase', example: 'How much is this book?' },
    { word: 'book', arabic: '\u0643\u062a\u0627\u0628', pos: 'noun', example: 'I read a book.' },
    { word: 'teacher', arabic: '\u0645\u0639\u0644\u0645', pos: 'noun', example: 'My teacher is kind.' },
    { word: 'student', arabic: '\u0637\u0627\u0644\u0628', pos: 'noun', example: 'I am a student.' },
    { word: 'help', arabic: '\u064a\u0633\u0627\u0639\u062f', pos: 'verb', example: 'Can you help me?' },
    { word: 'please', arabic: '\u0645\u0646 \u0641\u0636\u0644\u0643', pos: 'adverb', example: 'Please open the door.' },
    { word: 'write', arabic: '\u064a\u0643\u062a\u0628', pos: 'verb', example: 'I write my name.' },
  ];

  const vocab = db.insert(vocabularyItems).values(demoWords.map((item, index) => ({
    bookId: book.id,
    word: item.word,
    arabicMeaning: item.arabic,
    partOfSpeech: item.pos,
    exampleSentence: item.example,
    difficultyTier: index < 6 ? 1 : 2,
    unit: index < 6 ? 1 : 2,
    sortOrder: index,
    sentenceFrames: JSON.stringify([item.example]),
  }))).returning().all();

  const tasks = db.insert(practiceTasks).values(vocab.map((item) => ({
    bookId: book.id,
    vocabularyItemId: item.id,
    taskType: 'ListenRepeat',
    prompt: `Listen and repeat: "${item.word}"`,
    expectedAnswers: JSON.stringify([item.word]),
    passScore: 0.75,
  }))).returning().all();

  const [cycle] = db.insert(cycles).values({
    startDate: dateDaysFromNow(-7),
    endDate: dateDaysFromNow(21),
    bookId: book.id,
    teacherNotes: 'Demo cohort for Railway customer walkthrough.',
  }).returning().all();

  const demoStudents = db.insert(students).values([
    {
      uniqueNumber: '1',
      fullName: 'Ahmed Ali',
      class: 'A1 Morning',
      cefrBand: 'A1',
      isActive: true,
      notes: 'Demo student assigned to every major feature.',
      diagnosticJson: JSON.stringify({
        suggestedCefr: 'A1',
        fluencyIndex: 68,
        speechRateWpm: 92,
        pronAvg: 72,
        contentScore: 78,
        weakestSkill: 'pronunciation',
        recommendedStartingStage: 'repeat',
        recommendedPracticePath: [
          { title: 'Repeat practice', href: '/practice?stage=repeat', reason: 'Build clearer sound imitation first.' },
          { title: 'Read aloud', href: '/practice?stage=read-aloud', reason: 'Practice full-word decoding with visible text.' },
          { title: 'Sentence practice', href: '/practice?stage=sentence', reason: 'Build complete sentences before open speech.' },
          { title: 'Free Speak', href: '/practice?stage=free-speak', reason: 'Use vocabulary in your own sentence.' },
          { title: 'Scenario practice', href: '/practice/conversation?mode=scenarios', reason: 'Practice target language in a guided conversation.' },
        ],
      }),
      onboardedAt: isoDaysFromNow(-6),
    },
    {
      uniqueNumber: '1002',
      fullName: 'Layla Hassan',
      class: 'A1 Morning',
      cefrBand: 'A2',
      isActive: true,
      diagnosticJson: JSON.stringify({ suggestedCefr: 'A2', fluencyIndex: 76, pronAvg: 81, weakestSkill: 'fluency' }),
      onboardedAt: isoDaysFromNow(-8),
    },
    {
      uniqueNumber: '1003',
      fullName: 'Omar Saleh',
      class: 'A1 Evening',
      cefrBand: 'A1',
      isActive: true,
      diagnosticJson: JSON.stringify({ suggestedCefr: 'A1', fluencyIndex: 54, pronAvg: 62, weakestSkill: 'sentence production' }),
      onboardedAt: isoDaysFromNow(-3),
    },
    {
      uniqueNumber: '1004',
      fullName: 'Sara Noor',
      class: 'A2 Bridge',
      cefrBand: 'A2',
      isActive: true,
      diagnosticJson: JSON.stringify({ suggestedCefr: 'A2', fluencyIndex: 84, pronAvg: 86, weakestSkill: 'recall readiness' }),
      onboardedAt: isoDaysFromNow(-12),
    },
  ]).returning().all();
  const [ahmed, layla, omar, sara] = demoStudents;

  db.insert(studentCycles).values(demoStudents.map((student) => ({
    studentId: student.id,
    cycleId: cycle.id,
    enrolledAt: isoDaysFromNow(-7),
  }))).run();

  db.insert(userAccounts).values([
    {
      username: 'admin',
      passwordHash: hashPassword(adminPassword),
      role: 'Admin',
      displayName: 'Demo Administrator',
      isActive: true,
      createdAt: now,
    },
    {
      username: 'teacher',
      passwordHash: hashPassword(teacherPassword),
      role: 'Teacher',
      displayName: 'Demo Teacher',
      isActive: true,
      createdAt: now,
    },
    {
      username: '1',
      passwordHash: hashPassword(studentPassword),
      role: 'Student',
      studentId: ahmed.id,
      displayName: 'Ahmed Ali',
      isActive: true,
      createdAt: now,
    },
  ]).run();
  const teacher = db.select().from(userAccounts).where(eq(userAccounts.username, 'teacher')).get();

  const [source] = db.insert(klpImportSources).values({
    name: 'Demo ALC KLP sample',
    fileName: 'sanitized-demo-seed',
    importedAt: now,
    importedByUserId: null,
    totalConcepts: 6,
    activeQuestionShapes: 6,
    warningsJson: JSON.stringify(['Demo sample only. Import the full workbook after deployment for full KLP coverage.']),
    status: 'imported',
  }).returning().all();

  const klps = db.insert(klpConcepts).values([
    {
      sourceId: source.id,
      conceptId: 'DEMO-B1-L1-VOC-WATER',
      book: '1',
      lesson: '1',
      domain: 'Vocabulary',
      conceptNumber: '1',
      subdivision: 'A',
      baseItem: 'water',
      subtype: 'water',
      partOfSpeech: 'noun',
      definition: 'Use water in simple needs and requests.',
      dliClassification: 'ALC demo',
      primarySkillType: 'Speaking',
      supportStatus: 'speaking_scored',
      activeQuestionCount: 1,
      activeQuestionShapesJson: JSON.stringify(['Repeat and use in a sentence']),
      rawJson: JSON.stringify({ demo: true }),
      createdAt: now,
    },
    {
      sourceId: source.id,
      conceptId: 'DEMO-B1-L1-VOC-WANT',
      book: '1',
      lesson: '1',
      domain: 'Vocabulary',
      conceptNumber: '2',
      subdivision: 'A',
      baseItem: 'want',
      subtype: 'want',
      partOfSpeech: 'verb',
      definition: 'Use want to ask for simple items.',
      dliClassification: 'ALC demo',
      primarySkillType: 'Speaking',
      supportStatus: 'speaking_scored',
      activeQuestionCount: 1,
      activeQuestionShapesJson: JSON.stringify(['Sentence production']),
      rawJson: JSON.stringify({ demo: true }),
      createdAt: now,
    },
    {
      sourceId: source.id,
      conceptId: 'DEMO-B1-L2-FUNC-POLITE',
      book: '1',
      lesson: '2',
      domain: 'Function',
      conceptNumber: '3',
      subdivision: 'A',
      baseItem: 'polite request',
      subtype: 'please / thank you',
      definition: 'Make a polite request and thank the listener.',
      dliClassification: 'ALC demo',
      primarySkillType: 'Speaking',
      supportStatus: 'prompt_context_only',
      activeQuestionCount: 1,
      activeQuestionShapesJson: JSON.stringify(['Role-play prompt context']),
      rawJson: JSON.stringify({ demo: true, assessed: false }),
      createdAt: now,
    },
    {
      sourceId: source.id,
      conceptId: 'DEMO-B1-L2-VOC-HOW-MUCH',
      book: '1',
      lesson: '2',
      domain: 'Vocabulary',
      conceptNumber: '4',
      subdivision: 'A',
      baseItem: 'how much',
      subtype: 'how much',
      partOfSpeech: 'phrase',
      definition: 'Ask about price.',
      dliClassification: 'ALC demo',
      primarySkillType: 'Speaking',
      supportStatus: 'speaking_scored',
      activeQuestionCount: 1,
      activeQuestionShapesJson: JSON.stringify(['Scenario question']),
      rawJson: JSON.stringify({ demo: true }),
      createdAt: now,
    },
    {
      sourceId: source.id,
      conceptId: 'DEMO-B1-L3-GRAM-AM',
      book: '1',
      lesson: '3',
      domain: 'Grammar',
      conceptNumber: '5',
      subdivision: 'A',
      baseItem: 'be: am',
      subtype: 'am',
      definition: 'Use am in short self-statements.',
      dliClassification: 'ALC demo',
      primarySkillType: 'Speaking',
      supportStatus: 'prompt_context_only',
      activeQuestionCount: 1,
      activeQuestionShapesJson: JSON.stringify(['Prompt context only']),
      rawJson: JSON.stringify({ demo: true, assessed: false }),
      createdAt: now,
    },
    {
      sourceId: source.id,
      conceptId: 'DEMO-B1-L3-VOC-READY',
      book: '1',
      lesson: '3',
      domain: 'Vocabulary',
      conceptNumber: '6',
      subdivision: 'A',
      baseItem: 'ready',
      subtype: 'ready',
      partOfSpeech: 'adjective',
      definition: 'Say that you are prepared.',
      dliClassification: 'ALC demo',
      primarySkillType: 'Speaking',
      supportStatus: 'speaking_scored',
      activeQuestionCount: 1,
      activeQuestionShapesJson: JSON.stringify(['Free speak']),
      rawJson: JSON.stringify({ demo: true }),
      createdAt: now,
    },
  ]).returning().all();

  db.insert(klpActiveQuestionShapes).values(klps.map((klp, index) => ({
    sourceId: source.id,
    questionId: `DEMO-Q-${index + 1}`,
    conceptId: klp.conceptId,
    questionShape: index % 2 === 0 ? 'Say the word in a sentence' : 'Complete a short speaking role-play',
    modality: 'speaking',
    rawJson: JSON.stringify({ demo: true }),
  }))).run();

  const klpByTerm = new Map<string, number>();
  for (const klp of klps) {
    if (klp.subtype) klpByTerm.set(klp.subtype.toLowerCase(), klp.id);
    if (klp.baseItem) klpByTerm.set(klp.baseItem.toLowerCase(), klp.id);
  }
  for (const task of tasks) {
    const vocabItem = vocab.find((item) => item.id === task.vocabularyItemId);
    if (!vocabItem) continue;
    const klpId = klpByTerm.get(vocabItem.word.toLowerCase());
    if (!klpId) continue;
    db.insert(practiceTaskKlps).values({
      practiceTaskId: task.id,
      klpConceptId: klpId,
      assessmentMode: 'speaking_performance',
      createdAt: now,
    }).run();
  }

  const taskByWord = new Map(vocab.map((item) => [item.word, tasks.find((task) => task.vocabularyItemId === item.id)!]));
  const attemptsToInsert = [
    { student: ahmed, word: 'water', transcript: 'water', composite: 0.96, days: -5, stage: 'repeat' },
    { student: ahmed, word: 'want', transcript: 'I want water', composite: 0.82, days: -4, stage: 'sentence' },
    { student: ahmed, word: 'write', transcript: 'right', composite: 0.48, days: -3, stage: 'repeat' },
    { student: layla, word: 'thank you', transcript: 'thank you teacher', composite: 0.88, days: -2, stage: 'sentence' },
    { student: omar, word: 'am', transcript: 'I am student', composite: 0.55, days: -1, stage: 'free-speak' },
    { student: sara, word: 'how much', transcript: 'How much is this book?', composite: 0.91, days: -1, stage: 'sentence' },
  ];
  const insertedAttempts = [];
  for (const item of attemptsToInsert) {
    const task = taskByWord.get(item.word);
    const vocabItem = vocab.find((word) => word.word === item.word);
    if (!task || !vocabItem) continue;
    const score = item.composite;
    const attempt = db.insert(attempts).values({
      studentId: item.student.id,
      cycleId: cycle.id,
      bookId: book.id,
      practiceTaskId: task.id,
      timestamp: isoDaysFromNow(item.days),
      rawTranscript: item.transcript,
      targetMatchScore: Math.min(1, score + 0.08),
      pronunciationScore: score,
      fluencyScore: Math.min(1, score + 0.04),
      completenessScore: Math.min(1, score + 0.06),
      consistencyScore: Math.max(0.2, score - 0.12),
      compositeScore: score,
      metricsJson: JSON.stringify({
        practiceStage: item.stage,
        wordCount: item.transcript.split(/\s+/).length,
        audioDurationSeconds: 2.4,
        speechRateWpm: item.student.id === ahmed.id ? 92 : 104,
        fluencyIndex: Math.round(score * 100),
        pronunciationWeakWords: item.word === 'write'
          ? [{ word: 'write', accuracy: 42, errorType: 'Mispronunciation', weakPhonemes: [{ phoneme: 'r', accuracy: 40 }], stage: 'repeat', capturedAt: isoDaysFromNow(item.days) }]
          : [],
      }),
    }).returning().get();
    insertedAttempts.push({ attempt, item, vocabItem, task });
  }

  for (const row of insertedAttempts) {
    db.insert(wordMasteryRecords).values({
      studentId: row.item.student.id,
      vocabularyItemId: row.vocabItem.id,
      cycleId: cycle.id,
      timesSeen: 2,
      timesSpoken: row.item.student.id === ahmed.id ? 3 : 1,
      bestScore: row.item.composite,
      latestScore: row.item.composite,
      masteryStatus: row.item.composite >= 0.85 ? 'Mastered' : row.item.composite >= 0.6 ? 'Developing' : 'Attempted',
    }).run();
  }

  const [text] = db.insert(studentTexts).values({
    studentId: ahmed.id,
    title: 'My school day',
    originalText: 'I am a student. I want water. Thank you, teacher.',
    summary: 'Short A1 text for read-aloud and fluency practice.',
    wordCount: 10,
    createdAt: isoDaysFromNow(-5),
    lastPracticedAt: isoDaysFromNow(-2),
  }).returning().all();
  db.insert(textAttempts).values({
    studentTextId: text.id,
    studentId: ahmed.id,
    spokenTranscript: 'I am a student. I want water. Thank you teacher.',
    accuracyScore: 0.86,
    pronunciationScore: 0.74,
    fluencyScore: 0.78,
    completenessScore: 0.9,
    weakWords: JSON.stringify(['write', 'ready']),
    attemptedAt: isoDaysFromNow(-2),
    durationSeconds: 8.5,
  }).run();

  db.insert(studentWordLists).values({
    studentId: ahmed.id,
    name: 'Demo weak pronunciation words',
    words: JSON.stringify(['write', 'ready', 'how much']),
    createdAt: isoDaysFromNow(-3),
    lastPracticedAt: isoDaysFromNow(-1),
  }).run();

  db.insert(fluencyDrillSessions).values([
    {
      studentId: ahmed.id,
      cycleId: cycle.id,
      drillType: 'monologue',
      topicId: 'daily-routine',
      roundsJson: JSON.stringify([
        { round: 1, durationSeconds: 60, words: 42, fluencyIndex: 58 },
        { round: 2, durationSeconds: 45, words: 41, fluencyIndex: 69 },
        { round: 3, durationSeconds: 30, words: 34, fluencyIndex: 78 },
      ]),
      improvementScore: 20,
      createdAt: isoDaysFromNow(-2),
    },
    {
      studentId: layla.id,
      cycleId: cycle.id,
      drillType: 'shadowing',
      topicId: 'polite-request',
      roundsJson: JSON.stringify([{ sentence: 'Can you help me, please?', score: 84 }]),
      improvementScore: 12,
      createdAt: isoDaysFromNow(-1),
    },
  ]).run();

  const scenarioId = 'demo-klp-shop-water';
  db.insert(klpGeneratedScenarios).values({
    scenarioId,
    title: 'Buy water politely',
    description: 'Ask for water, ask the price, and thank the shop assistant.',
    cefrLevel: 'A1',
    icon: 'ShoppingBag',
    aiRole: 'a friendly shop assistant',
    studentGoal: 'Use water, how much, please, and thank you in a short conversation.',
    systemPrompt: 'You are a friendly shop assistant. Stay focused on buying water and asking the price. Redirect unrelated topics back to the lesson.',
    firstMessage: 'Hello! What would you like to buy today?',
    successCriteriaJson: JSON.stringify([
      'Responded with meaningful English',
      'Asked for water',
      'Asked the price with how much',
      'Used polite language such as please or thank you',
    ]),
    targetVocabularyJson: JSON.stringify(['water', 'how much', 'please', 'thank you']),
    minTurns: 4,
    progressionMode: 'guided',
    status: 'published',
    source: 'sanitized_demo',
    createdByUserId: teacher?.id ?? null,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    klpIdsJson: JSON.stringify(klps.map((klp) => klp.id)),
  }).run();
  for (const klp of klps) {
    db.insert(scenarioKlps).values({
      scenarioId,
      klpConceptId: klp.id,
      assessmentMode: klp.supportStatus === 'speaking_scored' ? 'speaking_performance' : 'context_only',
      createdAt: now,
    }).run();
  }

  const scenarioAttempt = db.insert(scenarioAttempts).values({
    studentId: ahmed.id,
    scenarioId,
    transcriptJson: JSON.stringify([
      { role: 'assistant', content: 'Hello! What would you like to buy today?' },
      { role: 'user', content: 'I want water, please.' },
      { role: 'assistant', content: 'Sure. One bottle is two dollars.' },
      { role: 'user', content: 'How much is two bottles?' },
      { role: 'assistant', content: 'Two bottles are four dollars.' },
      { role: 'user', content: 'Thank you.' },
    ]),
    criteriaMetJson: JSON.stringify([true, true, true, true]),
    score: 88,
    feedback: 'Good job staying on the task and using the target phrases.',
    createdAt: isoDaysFromNow(-1),
  }).returning().get();

  for (const klp of klps) {
    const assessed = klp.supportStatus === 'speaking_scored';
    db.insert(attemptKlpResults).values({
      attemptId: null,
      scenarioAttemptId: scenarioAttempt.id,
      studentId: ahmed.id,
      klpConceptId: klp.id,
      assessmentMode: assessed ? 'speaking_performance' : 'context_only',
      supportStatus: klp.supportStatus,
      assessed,
      successScorePercent: assessed ? 88 : 0,
      passed: assessed,
      confidence: assessed ? 0.85 : 0,
      rawScoresJson: JSON.stringify({ scenarioScore: 88, demo: true }),
      createdAt: isoDaysFromNow(-1),
    }).run();
    db.insert(studentKlpSummaries).values({
      studentId: ahmed.id,
      klpConceptId: klp.id,
      attempts: 1,
      successes: assessed ? 1 : 0,
      latestScorePercent: assessed ? 88 : 0,
      lastPracticedAt: isoDaysFromNow(-1),
    }).run();
  }

  const taskIds = tasks.slice(0, 8).map((task) => task.id);
  const wordIds = vocab.slice(0, 8).map((item) => item.id);
  const [homework] = db.insert(homeworkAssignments).values({
    cycleId: cycle.id,
    createdByUserId: teacher?.id ?? 1,
    title: 'Demo full speaking path for Ahmed',
    description: 'Covers repeat, read aloud, sentence, free speak, weak words, fluency drills, text practice, and KLP scenario work.',
    wordIds: JSON.stringify(wordIds),
    taskTypes: JSON.stringify(['repeat', 'read-aloud', 'sentence', 'free-speak', 'scenario', 'weak-words', 'fluency-drills', 'text-practice']),
    dueDate: dateDaysFromNow(7),
    className: 'A1 Morning',
    targetType: 'student',
    studentIdsJson: JSON.stringify([ahmed.id]),
    klpIdsJson: JSON.stringify(klps.map((klp) => klp.id)),
    scenarioIdsJson: JSON.stringify([scenarioId]),
    source: 'klp',
    status: 'assigned',
    createdAt: now,
  }).returning().all();
  db.insert(homeworkSubmissions).values({
    homeworkId: homework.id,
    studentId: ahmed.id,
    completedAt: null,
    wordsCompleted: 5,
    avgScore: 0.78,
  }).run();

  db.insert(customPracticeSets).values({
    name: 'Demo KLP Book 1 Lesson 1',
    cycleId: cycle.id,
    createdByUserId: teacher?.id ?? 1,
    wordIds: JSON.stringify(wordIds),
    taskTypes: JSON.stringify(['repeat', 'read-aloud', 'sentence', 'free-speak']),
    isActive: true,
    createdAt: now,
  }).run();
  db.insert(liveSessions).values({
    cycleId: cycle.id,
    createdByUserId: teacher?.id ?? 1,
    startedAt: isoDaysFromNow(-1),
    endedAt: null,
    taskType: 'scenario',
    wordIds: JSON.stringify(wordIds.slice(0, 4)),
    className: 'A1 Morning',
  }).run();

  db.insert(speechReliabilityEvents).values([
    { studentId: ahmed.id, userId: null, className: 'A1 Morning', eventType: 'stt', provider: 'azure-speech', route: '/api/stt/azure-transcribe', practiceStage: 'repeat', scenarioId: null, practiceTaskId: taskByWord.get('water')?.id ?? null, success: true, statusCode: 200, errorCode: null, latencyMs: 920, noSpeech: false, fallbackUsed: false, metadataJson: JSON.stringify({ demo: true }), createdAt: isoDaysFromNow(-5) },
    { studentId: ahmed.id, userId: null, className: 'A1 Morning', eventType: 'pronunciation', provider: 'azure-pronunciation', route: '/api/pronunciation/assess', practiceStage: 'repeat', scenarioId: null, practiceTaskId: taskByWord.get('write')?.id ?? null, success: true, statusCode: 200, errorCode: null, latencyMs: 1180, noSpeech: false, fallbackUsed: false, metadataJson: JSON.stringify({ weakWord: 'write', demo: true }), createdAt: isoDaysFromNow(-3) },
    { studentId: omar.id, userId: null, className: 'A1 Evening', eventType: 'stt', provider: 'azure-speech', route: '/api/stt/azure-transcribe', practiceStage: 'free-speak', scenarioId: null, practiceTaskId: taskByWord.get('am')?.id ?? null, success: false, statusCode: 422, errorCode: 'no-speech', latencyMs: 430, noSpeech: true, fallbackUsed: true, metadataJson: JSON.stringify({ demo: true }), createdAt: isoDaysFromNow(-1) },
    { studentId: layla.id, userId: null, className: 'A1 Morning', eventType: 'recording', provider: 'browser-mediarecorder', route: 'practice-recording-start', practiceStage: 'sentence', scenarioId: null, practiceTaskId: null, success: true, statusCode: null, errorCode: null, latencyMs: 90, noSpeech: false, fallbackUsed: false, metadataJson: JSON.stringify({ demo: true }), createdAt: isoDaysFromNow(-2) },
  ]).run();

  db.insert(teacherFlags).values({
    attemptId: insertedAttempts.find((item) => item.item.word === 'write')?.attempt.id ?? null,
    studentId: ahmed.id,
    flagType: 'pronunciation_review',
    notes: 'Demo flag: review /r/ sound in write/right minimal pair.',
    createdAt: isoDaysFromNow(-2),
    resolvedAt: null,
  }).run();

  db.insert(dailyGoals).values([
    { studentId: ahmed.id, date: dateDaysFromNow(0), targetWords: 8, completedWords: 5, completed: false },
    { studentId: layla.id, date: dateDaysFromNow(0), targetWords: 8, completedWords: 8, completed: true },
  ]).run();
  db.insert(spacedRepetitionQueue).values(wordIds.slice(0, 4).map((wordId, index) => ({
    studentId: ahmed.id,
    vocabularyItemId: wordId,
    cycleId: cycle.id,
    interval: index + 1,
    easeFactor: 2.2,
    repetitions: index,
    nextReviewDate: dateDaysFromNow(index),
    lastReviewDate: dateDaysFromNow(-index - 1),
  }))).run();
  db.insert(studentXp).values([
    { studentId: ahmed.id, amount: 120, reason: 'practice_attempt', earnedAt: isoDaysFromNow(-2) },
    { studentId: ahmed.id, amount: 50, reason: 'word_mastered', earnedAt: isoDaysFromNow(-1) },
  ]).run();
  const badgeCatalog = seedBadgeCatalog();
  const firstWordBadge = badgeCatalog.find((badge) => badge.code === 'first_word');
  const perfectBadge = badgeCatalog.find((badge) => badge.code === 'perfect_score');
  if (firstWordBadge) db.insert(studentBadges).values({ studentId: ahmed.id, badgeId: firstWordBadge.id, earnedAt: isoDaysFromNow(-5) }).run();
  if (perfectBadge) db.insert(studentBadges).values({ studentId: ahmed.id, badgeId: perfectBadge.id, earnedAt: isoDaysFromNow(-5) }).run();

  upsertSetting('demo_data_seeded_at', now);
  upsertSetting('klp_features_enabled', 'true');
  upsertSetting('ai_conversation_scenario_scoring_mode', 'live');
  upsertSetting('stt_engine', 'azure-speech');
  upsertSetting('tts_engine', 'kokoro');
  upsertSetting('pass_threshold', '0.75');
  upsertSetting('mastery_threshold', '0.85');
  upsertSetting('demo_student_task_ids', JSON.stringify(taskIds));

  console.log('[seed] Sanitized Railway demo data seeded successfully.');
}

function syncSanitizedDemoLoginPasswords(): void {
  const demoPasswords = [
    { username: 'admin', envName: 'DEMO_ADMIN_PASSWORD' },
    { username: 'teacher', envName: 'DEMO_TEACHER_PASSWORD' },
    { username: '1', envName: 'DEMO_STUDENT_PASSWORD' },
  ];

  for (const item of demoPasswords) {
    const password = process.env[item.envName]?.trim();
    if (!password) {
      console.warn(`[seed] ${item.envName} is not set; leaving ${item.username} password unchanged.`);
      continue;
    }

    const existing = db.select().from(userAccounts).where(eq(userAccounts.username, item.username)).get();
    if (!existing) {
      console.warn(`[seed] Demo account ${item.username} does not exist; password sync skipped.`);
      continue;
    }

    if (!verifyPassword(password, existing.passwordHash)) {
      db.update(userAccounts)
        .set({ passwordHash: hashPassword(password) })
        .where(eq(userAccounts.id, existing.id))
        .run();
    }
  }
}

function ensureDemoLoginAccounts(): void {
  const resetPasswords = process.env.SPEAKING_LAB_RESET_DEMO_LOGINS === '1';
  const now = new Date().toISOString();

  let student = db
    .select()
    .from(students)
    .where(eq(students.uniqueNumber, '1'))
    .get();

  if (!student) {
    [student] = db
      .insert(students)
      .values({
        uniqueNumber: '1',
        fullName: 'Ahmed Ali',
        class: 'Class A',
        cefrBand: 'A1',
        isActive: true,
      })
      .returning()
      .all();
  } else if (!student.isActive) {
    db.update(students)
      .set({ isActive: true })
      .where(eq(students.id, student.id))
      .run();
  }

  const demos = [
    { username: 'admin', password: 'admin', role: 'Admin', displayName: 'Administrator', studentId: null },
    { username: 'teacher', password: 'teacher', role: 'Teacher', displayName: 'Teacher', studentId: null },
    { username: '1', password: '1', role: 'Student', displayName: 'Ahmed Ali', studentId: student.id },
  ];

  for (const demo of demos) {
    const existing = db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.username, demo.username))
      .get();

    if (!existing) {
      db.insert(userAccounts)
        .values({
          username: demo.username,
          passwordHash: hashPassword(demo.password),
          role: demo.role,
          studentId: demo.studentId,
          displayName: demo.displayName,
          isActive: true,
          createdAt: now,
        })
        .run();
      continue;
    }

    const shouldResetPassword = resetPasswords && !verifyPassword(demo.password, existing.passwordHash);
    db.update(userAccounts)
      .set({
        role: demo.role,
        studentId: demo.studentId,
        displayName: demo.displayName,
        isActive: true,
        ...(shouldResetPassword ? { passwordHash: hashPassword(demo.password) } : {}),
      })
      .where(eq(userAccounts.id, existing.id))
      .run();
  }
}
