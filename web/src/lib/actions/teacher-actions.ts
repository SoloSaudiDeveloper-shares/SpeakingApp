import { db } from '../db';
import {
  students,
  attempts,
  wordMasteryRecords,
  vocabularyItems,
  teacherFlags,
  cycles,
  studentCycles,
  books,
} from '../db/schema';
import { eq, and, desc, count, isNull } from 'drizzle-orm';

export async function getTeacherDashboard() {
  const allStudents = (await db.select().from(students).where(eq(students.isActive, true)));

  return allStudents.map(async (s) => {
    const flagCount = ((await db
      .select({ value: count() })
      .from(teacherFlags)
      .where(and(eq(teacherFlags.studentId, s.id), isNull(teacherFlags.resolvedAt))).limit(1))[0]);

    // Total attempts (for the count column)
    const totalCount = ((await db
      .select({ value: count() })
      .from(attempts)
      .where(eq(attempts.studentId, s.id)).limit(1))[0]);

    // Average across recent attempts (for a current-performance signal)
    const recentAttempts = (await db
      .select()
      .from(attempts)
      .where(eq(attempts.studentId, s.id))
      .orderBy(desc(attempts.timestamp))
      .limit(20));

    const avgScore = recentAttempts.length
      ? recentAttempts.reduce((sum, a) => sum + a.compositeScore, 0) / recentAttempts.length
      : 0;

    return {
      ...s,
      flagCount: flagCount?.value ?? 0,
      recentAvgScore: avgScore,
      attemptCount: totalCount?.value ?? 0,
    };
  });
}

export async function getStudentReview(studentId: number) {
  const student = ((await db.select().from(students).where(eq(students.id, studentId)).limit(1))[0]);
  if (!student) return null;

  const enrollments = (await db
    .select()
    .from(studentCycles)
    .where(eq(studentCycles.studentId, studentId)));

  const latestEnrollment = enrollments[enrollments.length - 1];
  if (!latestEnrollment) return { student, cycle: null, book: null, attempts: [], mastery: [] };

  const cycle = ((await db.select().from(cycles).where(eq(cycles.id, latestEnrollment.cycleId)).limit(1))[0]);
  const book = cycle ? ((await db.select().from(books).where(eq(books.id, cycle.bookId)).limit(1))[0]) : null;

  const studentAttempts = (await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.studentId, studentId), eq(attempts.cycleId, latestEnrollment.cycleId)))
    .orderBy(desc(attempts.timestamp)));

  const mastery = (await db
    .select()
    .from(wordMasteryRecords)
    .where(
      and(
        eq(wordMasteryRecords.studentId, studentId),
        eq(wordMasteryRecords.cycleId, latestEnrollment.cycleId)
      )
    ));

  const vocab = book
    ? (await db.select().from(vocabularyItems).where(eq(vocabularyItems.bookId, book.id)))
    : [];

  return {
    student,
    cycle,
    book,
    attempts: studentAttempts,
    mastery: mastery.map((m) => ({
      ...m,
      vocabulary: vocab.find((v) => v.id === m.vocabularyItemId),
    })),
    vocabulary: vocab,
  };
}

export async function overrideAttemptScore(attemptId: number, score: number, notes: string) {
  (await db.update(attempts)
    .set({
      teacherOverrideScore: score,
      teacherNotes: notes,
    })
    .where(eq(attempts.id, attemptId)));
}
