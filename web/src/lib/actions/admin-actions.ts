import { db } from '../db';
import {
  students,
  books,
  vocabularyItems,
  cycles,
  studentCycles,
  practiceTasks,
  appSettings,
  attempts,
  liveSessions,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword } from './auth-actions';
import { MIN_PASSWORD_LENGTH } from '../utils/password';
import { isSecretLikeSettingKey } from '../secrets/sensitive-setting';
import { userAccounts, sessions } from '../db/schema';

// ─── STUDENTS ────────────────────────────────────────────────────────────────

export async function getStudents() {
  // A migrated profile may remain available for historical reporting while
  // its weak login is disabled, so show the linked account state when present.
  const rows = (await db
    .select({
      id: students.id,
      uniqueNumber: students.uniqueNumber,
      fullName: students.fullName,
      class: students.class,
      cefrBand: students.cefrBand,
      studentIsActive: students.isActive,
      accountIsActive: userAccounts.isActive,
      notes: students.notes,
      diagnosticJson: students.diagnosticJson,
      onboardedAt: students.onboardedAt,
      userId: userAccounts.id,
    })
    .from(students)
    .leftJoin(userAccounts, eq(userAccounts.studentId, students.id)));
  return rows.map(({ studentIsActive, accountIsActive, ...row }) => ({
    ...row,
    isActive: row.userId ? Boolean(accountIsActive) : studentIsActive,
    hasDiagnostic: !!row.diagnosticJson,
    diagnosticTakenAt: (() => {
      if (!row.diagnosticJson) return null;
      try {
        const parsed = JSON.parse(row.diagnosticJson) as { takenAt?: string };
        return parsed.takenAt ?? row.onboardedAt ?? null;
      } catch {
        return row.onboardedAt ?? null;
      }
    })(),
  }));
}

export async function getTeacherAccounts() {
  return db
    .select({
      id: userAccounts.id,
      username: userAccounts.username,
      displayName: userAccounts.displayName,
      isActive: userAccounts.isActive,
      mustChangePassword: userAccounts.mustChangePassword,
      lastLoginAt: userAccounts.lastLoginAt,
      createdAt: userAccounts.createdAt,
    })
    .from(userAccounts)
    .where(eq(userAccounts.role, 'Teacher'))
    .orderBy(userAccounts.username);
}

export async function resetTeacherPasswordAndActivate(id: number, password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  return db.transaction(async (tx) => {
    const [account] = await tx
      .update(userAccounts)
      .set({
        passwordHash: hashPassword(password),
        isActive: true,
        mustChangePassword: true,
      })
      .where(and(eq(userAccounts.id, id), eq(userAccounts.role, 'Teacher')))
      .returning({
        id: userAccounts.id,
        username: userAccounts.username,
        displayName: userAccounts.displayName,
        isActive: userAccounts.isActive,
        mustChangePassword: userAccounts.mustChangePassword,
        lastLoginAt: userAccounts.lastLoginAt,
        createdAt: userAccounts.createdAt,
      });
    if (!account) throw new Error('Teacher account not found.');
    await tx.delete(sessions).where(eq(sessions.userId, account.id));
    return account;
  });
}

export async function deactivateTeacherAccount(id: number) {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .update(userAccounts)
      .set({ isActive: false })
      .where(and(eq(userAccounts.id, id), eq(userAccounts.role, 'Teacher')))
      .returning({
        id: userAccounts.id,
        username: userAccounts.username,
        displayName: userAccounts.displayName,
        isActive: userAccounts.isActive,
        mustChangePassword: userAccounts.mustChangePassword,
        lastLoginAt: userAccounts.lastLoginAt,
        createdAt: userAccounts.createdAt,
      });
    if (!account) throw new Error('Teacher account not found.');
    await tx.delete(sessions).where(eq(sessions.userId, account.id));
    return account;
  });
}

export async function getStudent(id: number) {
  const student = ((await db.select().from(students).where(eq(students.id, id)).limit(1))[0]);
  if (!student) return null;
  const ua = ((await db.select().from(userAccounts).where(eq(userAccounts.studentId, id)).limit(1))[0]);
  return { ...student, userId: ua?.id ?? null };
}

export async function createStudent(data: {
  uniqueNumber: string;
  fullName: string;
  class?: string;
  cefrBand?: string;
  password?: string;
}) {
  if (!data.password || data.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A temporary password of at least ${MIN_PASSWORD_LENGTH} characters is required.`);
  }

  return db.transaction(async (tx) => {
    const [student] = await tx
      .insert(students)
      .values({
        uniqueNumber: data.uniqueNumber,
        fullName: data.fullName,
        class: data.class || null,
        cefrBand: data.cefrBand || 'A1',
        isActive: true,
      })
      .returning();

    await tx.insert(userAccounts)
      .values({
        username: data.uniqueNumber,
        passwordHash: hashPassword(data.password!),
        role: 'Student',
        studentId: student.id,
        displayName: data.fullName,
        isActive: true,
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
      });

    return student;
  });
}

export async function updateStudent(
  id: number,
  data: {
    fullName?: string;
    class?: string | null;
    cefrBand?: string;
    isActive?: boolean;
    notes?: string | null;
    password?: string;
    resetDiagnostic?: boolean;
  },
) {
  if (data.password && data.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const updates: Record<string, unknown> = {};
  if (data.fullName !== undefined) updates.fullName = data.fullName;
  if (data.class !== undefined) updates.class = data.class;
  if (data.cefrBand !== undefined) updates.cefrBand = data.cefrBand;
  if (data.isActive !== undefined) updates.isActive = data.isActive;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.resetDiagnostic) {
    updates.diagnosticJson = null;
    updates.onboardedAt = null;
  }

  if (Object.keys(updates).length > 0) {
    (await db.update(students).set(updates).where(eq(students.id, id)));
  }

  // Sync the linked userAccount displayName when fullName changes
  if (data.fullName !== undefined) {
    (await db.update(userAccounts)
      .set({ displayName: data.fullName })
      .where(eq(userAccounts.studentId, id)));
  }

  // When a disabled login is being secured and reactivated, do not enable it
  // before the new password hash is committed. The password transaction below
  // applies both changes atomically.
  const activateWithPassword = data.isActive === true && Boolean(data.password);
  if (data.isActive !== undefined && !activateWithPassword) {
    await db.update(userAccounts)
      .set({ isActive: data.isActive })
      .where(eq(userAccounts.studentId, id));
  }

  // Reset password if requested
  if (data.password) {
    await db.transaction(async (tx) => {
      const [account] = await tx
        .update(userAccounts)
        .set({
          passwordHash: hashPassword(data.password!),
          mustChangePassword: true,
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        })
        .where(eq(userAccounts.studentId, id))
        .returning({ id: userAccounts.id });
      if (account) {
        await tx.delete(sessions).where(eq(sessions.userId, account.id));
      }
    });
  }

  return getStudent(id);
}

export async function deleteStudent(id: number) {
  // Cascade: delete user account sessions, then user account, then enrollments,
  // then attempts, then the student.
  const ua = ((await db.select().from(userAccounts).where(eq(userAccounts.studentId, id)).limit(1))[0]);
  if (ua) {
    (await db.delete(sessions).where(eq(sessions.userId, ua.id)));
    (await db.delete(userAccounts).where(eq(userAccounts.id, ua.id)));
  }
  (await db.delete(studentCycles).where(eq(studentCycles.studentId, id)));
  (await db.delete(attempts).where(eq(attempts.studentId, id)));
  (await db.delete(students).where(eq(students.id, id)));
  return true;
}

export async function getDistinctClasses(): Promise<string[]> {
  const rows = (await db.select({ class: students.class }).from(students));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.class && r.class.trim()) set.add(r.class.trim());
  }
  return Array.from(set).sort();
}

// ─── BOOKS ───────────────────────────────────────────────────────────────────

export async function getBooks() {
  return (await db.select().from(books));
}

export async function getBookWithVocabulary(bookId: number) {
  const book = ((await db.select().from(books).where(eq(books.id, bookId)).limit(1))[0]);
  if (!book) return null;
  const vocab = (await db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.bookId, bookId)));
  return { book, vocabulary: vocab };
}

export async function updateBook(id: number, data: { title?: string; cefrLevel?: string }) {
  const updates: Record<string, unknown> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.cefrLevel !== undefined) updates.cefrLevel = data.cefrLevel;
  if (Object.keys(updates).length === 0) return;
  (await db.update(books).set(updates).where(eq(books.id, id)));
}

export async function deleteBook(id: number) {
  // Cascade: delete tasks, vocab, then book. Cycles referring to this book
  // would need to be deleted too — refuse if cycles exist.
  const referencedCycles = (await db.select().from(cycles).where(eq(cycles.bookId, id)));
  if (referencedCycles.length > 0) {
    throw new Error(`Cannot delete: book is used by ${referencedCycles.length} cycle(s). Delete the cycles first.`);
  }
  (await db.delete(practiceTasks).where(eq(practiceTasks.bookId, id)));
  (await db.delete(vocabularyItems).where(eq(vocabularyItems.bookId, id)));
  (await db.delete(books).where(eq(books.id, id)));
  return true;
}

export async function importBook(data: {
  title: string;
  cefrLevel: string;
  words: Array<{
    word: string;
    arabicMeaning?: string;
    partOfSpeech?: string;
    exampleSentence?: string;
    unit?: number;
  }>;
}) {
  const [book] = (await db
    .insert(books)
    .values({
      title: data.title,
      cefrLevel: data.cefrLevel,
      totalWords: data.words.length,
    })
    .returning());

  const vocabRows = data.words.map((w, i) => ({
    bookId: book.id,
    word: w.word,
    arabicMeaning: w.arabicMeaning || null,
    partOfSpeech: w.partOfSpeech || null,
    exampleSentence: w.exampleSentence || null,
    difficultyTier: 1,
    unit: w.unit ?? 1,
    sortOrder: i,
  }));

  const insertedVocab = (await db.insert(vocabularyItems).values(vocabRows).returning());

  const taskRows = insertedVocab.map((v) => ({
    bookId: book.id,
    vocabularyItemId: v.id,
    taskType: 'ListenRepeat',
    prompt: `Listen and repeat: "${v.word}"`,
    expectedAnswers: JSON.stringify([v.word]),
    passScore: 0.6,
  }));

  (await db.insert(practiceTasks).values(taskRows));

  return book;
}

// ─── VOCABULARY ──────────────────────────────────────────────────────────────

export async function addVocabularyItem(
  bookId: number,
  data: {
    word: string;
    arabicMeaning?: string | null;
    partOfSpeech?: string | null;
    exampleSentence?: string | null;
    unit?: number;
  },
) {
  const max = (await db.select().from(vocabularyItems).where(eq(vocabularyItems.bookId, bookId)));
  const nextSort = max.length;

  const [item] = (await db
    .insert(vocabularyItems)
    .values({
      bookId,
      word: data.word,
      arabicMeaning: data.arabicMeaning ?? null,
      partOfSpeech: data.partOfSpeech ?? null,
      exampleSentence: data.exampleSentence ?? null,
      difficultyTier: 1,
      unit: data.unit ?? 1,
      sortOrder: nextSort,
    })
    .returning());

  // Auto-create a ListenRepeat task for the new word
  (await db.insert(practiceTasks)
    .values({
      bookId,
      vocabularyItemId: item.id,
      taskType: 'ListenRepeat',
      prompt: `Listen and repeat: "${data.word}"`,
      expectedAnswers: JSON.stringify([data.word]),
      passScore: 0.6,
    }));

  // Update book.totalWords
  (await db.update(books)
    .set({ totalWords: max.length + 1 })
    .where(eq(books.id, bookId)));

  return item;
}

export async function updateVocabularyItem(
  id: number,
  data: {
    word?: string;
    arabicMeaning?: string | null;
    partOfSpeech?: string | null;
    exampleSentence?: string | null;
    unit?: number;
  },
) {
  const updates: Record<string, unknown> = {};
  if (data.word !== undefined) updates.word = data.word;
  if (data.arabicMeaning !== undefined) updates.arabicMeaning = data.arabicMeaning;
  if (data.partOfSpeech !== undefined) updates.partOfSpeech = data.partOfSpeech;
  if (data.exampleSentence !== undefined) updates.exampleSentence = data.exampleSentence;
  if (data.unit !== undefined) updates.unit = data.unit;
  if (Object.keys(updates).length === 0) return;
  (await db.update(vocabularyItems).set(updates).where(eq(vocabularyItems.id, id)));

  // If word text changed, sync the practiceTasks expected answers
  if (data.word !== undefined) {
    (await db.update(practiceTasks)
      .set({
        prompt: `Listen and repeat: "${data.word}"`,
        expectedAnswers: JSON.stringify([data.word]),
      })
      .where(eq(practiceTasks.vocabularyItemId, id)));
  }
}

export async function deleteVocabularyItem(id: number) {
  const item = ((await db.select().from(vocabularyItems).where(eq(vocabularyItems.id, id)).limit(1))[0]);
  if (!item) return false;
  // Delete linked tasks first
  (await db.delete(practiceTasks).where(eq(practiceTasks.vocabularyItemId, id)));
  (await db.delete(vocabularyItems).where(eq(vocabularyItems.id, id)));
  // Update book total
  const remaining = (await db.select().from(vocabularyItems).where(eq(vocabularyItems.bookId, item.bookId)));
  (await db.update(books).set({ totalWords: remaining.length }).where(eq(books.id, item.bookId)));
  return true;
}

// ─── CYCLES ──────────────────────────────────────────────────────────────────

export async function getCycles() {
  const allCycles = (await db.select().from(cycles));
  return allCycles.map(async (c) => {
    const book = ((await db.select().from(books).where(eq(books.id, c.bookId)).limit(1))[0]);
    const enrollments = (await db
      .select()
      .from(studentCycles)
      .where(eq(studentCycles.cycleId, c.id)));
    return { ...c, book, enrollmentCount: enrollments.length };
  });
}

export async function getCycleWithEnrollments(cycleId: number) {
  const cycle = ((await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1))[0]);
  if (!cycle) return null;
  const book = ((await db.select().from(books).where(eq(books.id, cycle.bookId)).limit(1))[0]);
  const enrollments = (await db
    .select({
      studentId: studentCycles.studentId,
      enrolledAt: studentCycles.enrolledAt,
      fullName: students.fullName,
      uniqueNumber: students.uniqueNumber,
      class: students.class,
      cefrBand: students.cefrBand,
    })
    .from(studentCycles)
    .leftJoin(students, eq(students.id, studentCycles.studentId))
    .where(eq(studentCycles.cycleId, cycleId)));
  return { ...cycle, book, enrollments };
}

export async function createCycle(data: {
  startDate: string;
  endDate: string;
  bookId: number;
  teacherNotes?: string;
}) {
  return ((await db
    .insert(cycles)
    .values({
      startDate: data.startDate,
      endDate: data.endDate,
      bookId: data.bookId,
      teacherNotes: data.teacherNotes || null,
    })
    .returning())[0]);
}

export async function updateCycle(
  id: number,
  data: { startDate?: string; endDate?: string; bookId?: number; teacherNotes?: string | null },
) {
  const updates: Record<string, unknown> = {};
  if (data.startDate !== undefined) updates.startDate = data.startDate;
  if (data.endDate !== undefined) updates.endDate = data.endDate;
  if (data.bookId !== undefined) updates.bookId = data.bookId;
  if (data.teacherNotes !== undefined) updates.teacherNotes = data.teacherNotes;
  if (Object.keys(updates).length === 0) return;
  (await db.update(cycles).set(updates).where(eq(cycles.id, id)));
}

export async function deleteCycle(id: number) {
  // Cascade attempts that reference this cycle
  (await db.delete(attempts).where(eq(attempts.cycleId, id)));
  (await db.delete(studentCycles).where(eq(studentCycles.cycleId, id)));
  (await db.delete(cycles).where(eq(cycles.id, id)));
  return true;
}

export async function enrollStudents(cycleId: number, studentIds: number[]) {
  const now = new Date().toISOString();
  for (const sid of studentIds) {
    const exists = ((await db
      .select()
      .from(studentCycles)
      .where(and(eq(studentCycles.cycleId, cycleId), eq(studentCycles.studentId, sid))).limit(1))[0]);
    if (!exists) {
      (await db.insert(studentCycles)
        .values({ studentId: sid, cycleId, enrolledAt: now }));
    }
  }
}

export async function unenrollStudent(cycleId: number, studentId: number) {
  (await db.delete(studentCycles)
    .where(and(eq(studentCycles.cycleId, cycleId), eq(studentCycles.studentId, studentId))));
  return true;
}

// ─── LIVE SESSIONS ───────────────────────────────────────────────────────────

export async function getLiveSessions() {
  return (await db.select().from(liveSessions));
}

export async function createLiveSession(data: {
  cycleId: number;
  createdByUserId: number;
  taskType: string;
  className?: string | null;
  wordIds?: number[];
}) {
  return ((await db
    .insert(liveSessions)
    .values({
      cycleId: data.cycleId,
      createdByUserId: data.createdByUserId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      taskType: data.taskType,
      wordIds: JSON.stringify(data.wordIds ?? []),
      className: data.className ?? null,
    })
    .returning())[0]);
}

export async function endLiveSession(id: number) {
  (await db.update(liveSessions)
    .set({ endedAt: new Date().toISOString() })
    .where(eq(liveSessions.id, id)));
}

export async function deleteLiveSession(id: number) {
  (await db.delete(liveSessions).where(eq(liveSessions.id, id)));
}

// ─── APP SETTINGS ────────────────────────────────────────────────────────────

export async function getAppSettings() {
  return (await db.select().from(appSettings));
}

export async function updateAppSetting(key: string, value: string) {
  if (isSecretLikeSettingKey(key)) {
    throw new Error('Secret-like configuration cannot be stored in app_settings.');
  }
  const existing = ((await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1))[0]);
  if (existing) {
    (await db.update(appSettings).set({ value }).where(eq(appSettings.key, key)));
  } else {
    (await db.insert(appSettings).values({ key, value }));
  }
}
