import { count } from 'drizzle-orm';
import { db } from './index';
import {
  appSettings,
  badges,
  books,
  cycles,
  homeworkAssignments,
  klpGeneratedScenarios,
  practiceTasks,
  studentCycles,
  students,
  userAccounts,
  vocabularyItems,
} from './schema';
import { hashPassword } from '../utils/password';

function requiredPassword(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < 12) {
    throw new Error(`${name} is required and must contain at least 12 characters.`);
  }
  return value;
}

async function databaseHasAccounts() {
  const row = (await db.select({ value: count() }).from(userAccounts))[0];
  return Number(row?.value ?? 0) > 0;
}

async function seedBootstrapAdmin() {
  if (await databaseHasAccounts()) {
    console.log('[seed] Existing accounts found; bootstrap admin was not created.');
    return;
  }
  const password = requiredPassword('BOOTSTRAP_ADMIN_PASSWORD');
  await db.insert(userAccounts).values({
    username: process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || 'bootstrap-admin',
    passwordHash: hashPassword(password),
    role: 'Admin',
    displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || 'Bootstrap administrator',
    isActive: true,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  });
  console.log('[seed] Bootstrap administrator created with mandatory password change.');
}

async function seedDemo() {
  const adminPassword = requiredPassword('DEMO_ADMIN_PASSWORD');
  const teacherPassword = requiredPassword('DEMO_TEACHER_PASSWORD');
  const studentPassword = requiredPassword('DEMO_STUDENT_PASSWORD');
  if (await databaseHasAccounts()) {
    console.log('[seed] Existing accounts found; demo seed was not applied.');
    return;
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const [book] = await db.insert(books).values({
    title: 'Everyday English — Pilot pathway',
    cefrLevel: 'A1',
    totalWords: 2,
  }).returning();
  const words = await db.insert(vocabularyItems).values([
    {
      bookId: book.id,
      word: 'order',
      arabicMeaning: 'يطلب',
      partOfSpeech: 'verb',
      exampleSentence: 'I would like to order a coffee.',
      difficultyTier: 1,
      unit: 1,
      sortOrder: 1,
    },
    {
      bookId: book.id,
      word: 'please',
      arabicMeaning: 'من فضلك',
      partOfSpeech: 'adverb',
      exampleSentence: 'A small coffee, please.',
      difficultyTier: 1,
      unit: 1,
      sortOrder: 2,
    },
  ]).returning();
  for (const word of words) {
    await db.insert(practiceTasks).values([
      {
        bookId: book.id,
        vocabularyItemId: word.id,
        taskType: 'ListenRepeat',
        prompt: `Listen and repeat: ${word.word}`,
        expectedAnswers: JSON.stringify([word.word]),
        passScore: 0.6,
      },
      {
        bookId: book.id,
        vocabularyItemId: word.id,
        taskType: 'SentenceFrame',
        prompt: word.exampleSentence || `Use ${word.word} in context.`,
        expectedAnswers: JSON.stringify([word.exampleSentence || word.word]),
        passScore: 0.6,
      },
      {
        bookId: book.id,
        vocabularyItemId: word.id,
        taskType: 'FreeRecall',
        prompt: `Create your own sentence with ${word.word}.`,
        expectedAnswers: JSON.stringify([word.word]),
        passScore: 0.6,
      },
    ]);
  }
  const [cycle] = await db.insert(cycles).values({
    startDate: today,
    endDate: due,
    bookId: book.id,
  }).returning();
  const [student] = await db.insert(students).values({
    uniqueNumber: 'demo-learner',
    fullName: 'Demo Learner',
    class: 'Pilot',
    cefrBand: 'A1',
    isActive: true,
  }).returning();
  await db.insert(studentCycles).values({ studentId: student.id, cycleId: cycle.id, enrolledAt: now });
  const accounts = await db.insert(userAccounts).values([
    {
      username: 'demo-admin',
      passwordHash: hashPassword(adminPassword),
      role: 'Admin',
      displayName: 'Demo Administrator',
      isActive: true,
      createdAt: now,
    },
    {
      username: 'demo-teacher',
      passwordHash: hashPassword(teacherPassword),
      role: 'Teacher',
      displayName: 'Demo Teacher',
      isActive: true,
      createdAt: now,
    },
    {
      username: 'demo-learner',
      passwordHash: hashPassword(studentPassword),
      role: 'Student',
      studentId: student.id,
      displayName: 'Demo Learner',
      isActive: true,
      createdAt: now,
    },
  ]).returning();
  const admin = accounts.find((account) => account.role === 'Admin');
  if (!admin) throw new Error('Demo administrator creation failed.');

  const scenarios = [
    {
      scenarioId: 'demo-controlled-coffee',
      title: 'Guided coffee order',
      progressionMode: 'controlled',
      description: 'Order a coffee using the target expressions.',
      aiRole: 'a patient café server',
      studentGoal: 'Order a coffee and use please.',
      systemPrompt: 'Act as a patient café server. Ask one short question at a time.',
      firstMessage: 'Hello. What would you like to order?',
    },
    {
      scenarioId: 'demo-open-coffee',
      title: 'Coffee shop conversation',
      progressionMode: 'open',
      description: 'Handle a natural coffee-shop conversation.',
      aiRole: 'a friendly café server',
      studentGoal: 'Complete a natural order and respond to follow-up questions.',
      systemPrompt: 'Act as a friendly café server. Keep the conversation natural and concise.',
      firstMessage: 'Hi there! What can I get for you today?',
    },
  ];
  for (const scenario of scenarios) {
    await db.insert(klpGeneratedScenarios).values({
      ...scenario,
      cefrLevel: 'A1',
      icon: 'Coffee',
      successCriteriaJson: JSON.stringify(['Ordered a drink', 'Used polite language']),
      targetVocabularyJson: JSON.stringify(['order', 'please']),
      minTurns: 3,
      maxTurns: 8,
      status: 'published',
      source: 'demo',
      createdByUserId: admin.id,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      klpIdsJson: '[]',
    });
  }
  await db.insert(homeworkAssignments).values({
    cycleId: cycle.id,
    createdByUserId: admin.id,
    title: 'Coffee shop pathway',
    description: 'Move from target-word practice to an open role-play.',
    wordIds: JSON.stringify(words.map((word) => word.id)),
    taskTypes: JSON.stringify(['repeat', 'sentence', 'free-speak', 'scenario']),
    dueDate: due,
    targetType: 'student',
    studentIdsJson: JSON.stringify([student.id]),
    scenarioIdsJson: JSON.stringify(scenarios.map((scenario) => scenario.scenarioId)),
    source: 'klp',
    status: 'assigned',
    pathConfigJson: JSON.stringify({
      version: 1,
      targetWordIds: words.map((word) => word.id),
      controlledScenarioId: scenarios[0].scenarioId,
      openScenarioId: scenarios[1].scenarioId,
      textPracticeId: null,
    }),
    createdAt: now,
  });
  await db.insert(badges).values([
    { code: 'first_word', name: 'First Word', description: 'Practise your first word.', icon: 'Star', xpReward: 10 },
    { code: 'streak_3', name: 'Three-day streak', description: 'Practise for three days.', icon: 'Flame', xpReward: 30 },
  ]);
  await db.insert(appSettings).values([
    { key: 'klp_features_enabled', value: 'true' },
    { key: 'pass_threshold', value: '0.6' },
    { key: 'mastery_threshold', value: '0.85' },
    { key: 'stt_scored_pause_threshold_ms', value: '1000' },
  ]);
  console.log('[seed] Environment-credentialed demo pathway created.');
}

export async function seedDatabase(): Promise<void> {
  if (process.env.DEMO_DATA_ENABLED === 'true') {
    await seedDemo();
    return;
  }
  await seedBootstrapAdmin();
}
