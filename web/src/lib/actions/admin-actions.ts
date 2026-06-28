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
import { userAccounts, sessions } from '../db/schema';

// ─── STUDENTS ────────────────────────────────────────────────────────────────

export function getStudents() {
  // Join students with userAccounts to include the userId for impersonation
  const rows = db
    .select({
      id: students.id,
      uniqueNumber: students.uniqueNumber,
      fullName: students.fullName,
      class: students.class,
      cefrBand: students.cefrBand,
      isActive: students.isActive,
      notes: students.notes,
      diagnosticJson: students.diagnosticJson,
      onboardedAt: students.onboardedAt,
      userId: userAccounts.id,
    })
    .from(students)
    .leftJoin(userAccounts, eq(userAccounts.studentId, students.id))
    .all();
  return rows.map((row) => ({
    ...row,
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

export function getStudent(id: number) {
  const student = db.select().from(students).where(eq(students.id, id)).get();
  if (!student) return null;
  const ua = db.select().from(userAccounts).where(eq(userAccounts.studentId, id)).get();
  return { ...student, userId: ua?.id ?? null };
}

export function createStudent(data: {
  uniqueNumber: string;
  fullName: string;
  class?: string;
  cefrBand?: string;
  password?: string;
}) {
  const [student] = db
    .insert(students)
    .values({
      uniqueNumber: data.uniqueNumber,
      fullName: data.fullName,
      class: data.class || null,
      cefrBand: data.cefrBand || 'A1',
      isActive: true,
    })
    .returning()
    .all();

  const pw = data.password || data.uniqueNumber;
  db.insert(userAccounts)
    .values({
      username: data.uniqueNumber,
      passwordHash: hashPassword(pw),
      role: 'Student',
      studentId: student.id,
      displayName: data.fullName,
      isActive: true,
      createdAt: new Date().toISOString(),
    })
    .run();

  return student;
}

export function updateStudent(
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
    db.update(students).set(updates).where(eq(students.id, id)).run();
  }

  // Sync the linked userAccount displayName when fullName changes
  if (data.fullName !== undefined) {
    db.update(userAccounts)
      .set({ displayName: data.fullName })
      .where(eq(userAccounts.studentId, id))
      .run();
  }

  // Reset password if requested
  if (data.password) {
    db.update(userAccounts)
      .set({ passwordHash: hashPassword(data.password) })
      .where(eq(userAccounts.studentId, id))
      .run();
  }

  return getStudent(id);
}

export function deleteStudent(id: number) {
  // Cascade: delete user account sessions, then user account, then enrollments,
  // then attempts, then the student.
  const ua = db.select().from(userAccounts).where(eq(userAccounts.studentId, id)).get();
  if (ua) {
    db.delete(sessions).where(eq(sessions.userId, ua.id)).run();
    db.delete(userAccounts).where(eq(userAccounts.id, ua.id)).run();
  }
  db.delete(studentCycles).where(eq(studentCycles.studentId, id)).run();
  db.delete(attempts).where(eq(attempts.studentId, id)).run();
  db.delete(students).where(eq(students.id, id)).run();
  return true;
}

export function getDistinctClasses(): string[] {
  const rows = db.select({ class: students.class }).from(students).all();
  const set = new Set<string>();
  for (const r of rows) {
    if (r.class && r.class.trim()) set.add(r.class.trim());
  }
  return Array.from(set).sort();
}

// ─── BOOKS ───────────────────────────────────────────────────────────────────

export function getBooks() {
  return db.select().from(books).all();
}

export function getBookWithVocabulary(bookId: number) {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) return null;
  const vocab = db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.bookId, bookId))
    .all();
  return { book, vocabulary: vocab };
}

export function updateBook(id: number, data: { title?: string; cefrLevel?: string }) {
  const updates: Record<string, unknown> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.cefrLevel !== undefined) updates.cefrLevel = data.cefrLevel;
  if (Object.keys(updates).length === 0) return;
  db.update(books).set(updates).where(eq(books.id, id)).run();
}

export function deleteBook(id: number) {
  // Cascade: delete tasks, vocab, then book. Cycles referring to this book
  // would need to be deleted too — refuse if cycles exist.
  const referencedCycles = db.select().from(cycles).where(eq(cycles.bookId, id)).all();
  if (referencedCycles.length > 0) {
    throw new Error(`Cannot delete: book is used by ${referencedCycles.length} cycle(s). Delete the cycles first.`);
  }
  db.delete(practiceTasks).where(eq(practiceTasks.bookId, id)).run();
  db.delete(vocabularyItems).where(eq(vocabularyItems.bookId, id)).run();
  db.delete(books).where(eq(books.id, id)).run();
  return true;
}

export function importBook(data: {
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
  const [book] = db
    .insert(books)
    .values({
      title: data.title,
      cefrLevel: data.cefrLevel,
      totalWords: data.words.length,
    })
    .returning()
    .all();

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

  const insertedVocab = db.insert(vocabularyItems).values(vocabRows).returning().all();

  const taskRows = insertedVocab.map((v) => ({
    bookId: book.id,
    vocabularyItemId: v.id,
    taskType: 'ListenRepeat',
    prompt: `Listen and repeat: "${v.word}"`,
    expectedAnswers: JSON.stringify([v.word]),
    passScore: 0.6,
  }));

  db.insert(practiceTasks).values(taskRows).run();

  return book;
}

// ─── VOCABULARY ──────────────────────────────────────────────────────────────

export function addVocabularyItem(
  bookId: number,
  data: {
    word: string;
    arabicMeaning?: string | null;
    partOfSpeech?: string | null;
    exampleSentence?: string | null;
    unit?: number;
  },
) {
  const max = db.select().from(vocabularyItems).where(eq(vocabularyItems.bookId, bookId)).all();
  const nextSort = max.length;

  const [item] = db
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
    .returning()
    .all();

  // Auto-create a ListenRepeat task for the new word
  db.insert(practiceTasks)
    .values({
      bookId,
      vocabularyItemId: item.id,
      taskType: 'ListenRepeat',
      prompt: `Listen and repeat: "${data.word}"`,
      expectedAnswers: JSON.stringify([data.word]),
      passScore: 0.6,
    })
    .run();

  // Update book.totalWords
  db.update(books)
    .set({ totalWords: max.length + 1 })
    .where(eq(books.id, bookId))
    .run();

  return item;
}

export function updateVocabularyItem(
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
  db.update(vocabularyItems).set(updates).where(eq(vocabularyItems.id, id)).run();

  // If word text changed, sync the practiceTasks expected answers
  if (data.word !== undefined) {
    db.update(practiceTasks)
      .set({
        prompt: `Listen and repeat: "${data.word}"`,
        expectedAnswers: JSON.stringify([data.word]),
      })
      .where(eq(practiceTasks.vocabularyItemId, id))
      .run();
  }
}

export function deleteVocabularyItem(id: number) {
  const item = db.select().from(vocabularyItems).where(eq(vocabularyItems.id, id)).get();
  if (!item) return false;
  // Delete linked tasks first
  db.delete(practiceTasks).where(eq(practiceTasks.vocabularyItemId, id)).run();
  db.delete(vocabularyItems).where(eq(vocabularyItems.id, id)).run();
  // Update book total
  const remaining = db.select().from(vocabularyItems).where(eq(vocabularyItems.bookId, item.bookId)).all();
  db.update(books).set({ totalWords: remaining.length }).where(eq(books.id, item.bookId)).run();
  return true;
}

// ─── CYCLES ──────────────────────────────────────────────────────────────────

export function getCycles() {
  const allCycles = db.select().from(cycles).all();
  return allCycles.map((c) => {
    const book = db.select().from(books).where(eq(books.id, c.bookId)).get();
    const enrollments = db
      .select()
      .from(studentCycles)
      .where(eq(studentCycles.cycleId, c.id))
      .all();
    return { ...c, book, enrollmentCount: enrollments.length };
  });
}

export function getCycleWithEnrollments(cycleId: number) {
  const cycle = db.select().from(cycles).where(eq(cycles.id, cycleId)).get();
  if (!cycle) return null;
  const book = db.select().from(books).where(eq(books.id, cycle.bookId)).get();
  const enrollments = db
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
    .where(eq(studentCycles.cycleId, cycleId))
    .all();
  return { ...cycle, book, enrollments };
}

export function createCycle(data: {
  startDate: string;
  endDate: string;
  bookId: number;
  teacherNotes?: string;
}) {
  return db
    .insert(cycles)
    .values({
      startDate: data.startDate,
      endDate: data.endDate,
      bookId: data.bookId,
      teacherNotes: data.teacherNotes || null,
    })
    .returning()
    .get();
}

export function updateCycle(
  id: number,
  data: { startDate?: string; endDate?: string; bookId?: number; teacherNotes?: string | null },
) {
  const updates: Record<string, unknown> = {};
  if (data.startDate !== undefined) updates.startDate = data.startDate;
  if (data.endDate !== undefined) updates.endDate = data.endDate;
  if (data.bookId !== undefined) updates.bookId = data.bookId;
  if (data.teacherNotes !== undefined) updates.teacherNotes = data.teacherNotes;
  if (Object.keys(updates).length === 0) return;
  db.update(cycles).set(updates).where(eq(cycles.id, id)).run();
}

export function deleteCycle(id: number) {
  // Cascade attempts that reference this cycle
  db.delete(attempts).where(eq(attempts.cycleId, id)).run();
  db.delete(studentCycles).where(eq(studentCycles.cycleId, id)).run();
  db.delete(cycles).where(eq(cycles.id, id)).run();
  return true;
}

export function enrollStudents(cycleId: number, studentIds: number[]) {
  const now = new Date().toISOString();
  for (const sid of studentIds) {
    const exists = db
      .select()
      .from(studentCycles)
      .where(and(eq(studentCycles.cycleId, cycleId), eq(studentCycles.studentId, sid)))
      .get();
    if (!exists) {
      db.insert(studentCycles)
        .values({ studentId: sid, cycleId, enrolledAt: now })
        .run();
    }
  }
}

export function unenrollStudent(cycleId: number, studentId: number) {
  db.delete(studentCycles)
    .where(and(eq(studentCycles.cycleId, cycleId), eq(studentCycles.studentId, studentId)))
    .run();
  return true;
}

// ─── LIVE SESSIONS ───────────────────────────────────────────────────────────

export function getLiveSessions() {
  return db.select().from(liveSessions).all();
}

export function createLiveSession(data: {
  cycleId: number;
  createdByUserId: number;
  taskType: string;
  className?: string | null;
  wordIds?: number[];
}) {
  return db
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
    .returning()
    .get();
}

export function endLiveSession(id: number) {
  db.update(liveSessions)
    .set({ endedAt: new Date().toISOString() })
    .where(eq(liveSessions.id, id))
    .run();
}

export function deleteLiveSession(id: number) {
  db.delete(liveSessions).where(eq(liveSessions.id, id)).run();
}

// ─── APP SETTINGS ────────────────────────────────────────────────────────────

export function getAppSettings() {
  return db.select().from(appSettings).all();
}

export function updateAppSetting(key: string, value: string) {
  const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (existing) {
    db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).run();
  } else {
    db.insert(appSettings).values({ key, value }).run();
  }
}
