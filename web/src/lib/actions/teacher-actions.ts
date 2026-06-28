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

export function getTeacherDashboard() {
  const allStudents = db.select().from(students).where(eq(students.isActive, true)).all();

  return allStudents.map((s) => {
    const flagCount = db
      .select({ value: count() })
      .from(teacherFlags)
      .where(and(eq(teacherFlags.studentId, s.id), isNull(teacherFlags.resolvedAt)))
      .get();

    // Total attempts (for the count column)
    const totalCount = db
      .select({ value: count() })
      .from(attempts)
      .where(eq(attempts.studentId, s.id))
      .get();

    // Average across recent attempts (for a current-performance signal)
    const recentAttempts = db
      .select()
      .from(attempts)
      .where(eq(attempts.studentId, s.id))
      .orderBy(desc(attempts.timestamp))
      .limit(20)
      .all();

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

export function getStudentReview(studentId: number) {
  const student = db.select().from(students).where(eq(students.id, studentId)).get();
  if (!student) return null;

  const enrollments = db
    .select()
    .from(studentCycles)
    .where(eq(studentCycles.studentId, studentId))
    .all();

  const latestEnrollment = enrollments[enrollments.length - 1];
  if (!latestEnrollment) return { student, cycle: null, book: null, attempts: [], mastery: [] };

  const cycle = db.select().from(cycles).where(eq(cycles.id, latestEnrollment.cycleId)).get();
  const book = cycle ? db.select().from(books).where(eq(books.id, cycle.bookId)).get() : null;

  const studentAttempts = db
    .select()
    .from(attempts)
    .where(and(eq(attempts.studentId, studentId), eq(attempts.cycleId, latestEnrollment.cycleId)))
    .orderBy(desc(attempts.timestamp))
    .all();

  const mastery = db
    .select()
    .from(wordMasteryRecords)
    .where(
      and(
        eq(wordMasteryRecords.studentId, studentId),
        eq(wordMasteryRecords.cycleId, latestEnrollment.cycleId)
      )
    )
    .all();

  const vocab = book
    ? db.select().from(vocabularyItems).where(eq(vocabularyItems.bookId, book.id)).all()
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

export function overrideAttemptScore(attemptId: number, score: number, notes: string) {
  db.update(attempts)
    .set({
      teacherOverrideScore: score,
      teacherNotes: notes,
    })
    .where(eq(attempts.id, attemptId))
    .run();
}
