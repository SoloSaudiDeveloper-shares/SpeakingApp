import { db } from '../db';
import {
  cycles,
  studentCycles,
  books,
  vocabularyItems,
  practiceTasks,
  attempts,
  wordMasteryRecords,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export function getCurrentCycle(studentId: number) {
  const enrollment = db
    .select()
    .from(studentCycles)
    .where(eq(studentCycles.studentId, studentId))
    .all();

  if (enrollment.length === 0) return null;

  const latestEnrollment = enrollment[enrollment.length - 1];
  const cycle = db
    .select()
    .from(cycles)
    .where(eq(cycles.id, latestEnrollment.cycleId))
    .get();

  if (!cycle) return null;

  const book = db
    .select()
    .from(books)
    .where(eq(books.id, cycle.bookId))
    .get();

  const vocab = db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.bookId, cycle.bookId))
    .all();

  const tasks = db
    .select()
    .from(practiceTasks)
    .where(eq(practiceTasks.bookId, cycle.bookId))
    .all();

  return { cycle, book, vocabulary: vocab, tasks, enrollment: latestEnrollment };
}

export function getStudentAttempts(studentId: number, cycleId: number) {
  return db
    .select()
    .from(attempts)
    .where(and(eq(attempts.studentId, studentId), eq(attempts.cycleId, cycleId)))
    .orderBy(desc(attempts.timestamp))
    .all();
}

export function masteryStatusFor(bestScore: number, latestScore: number, timesSpoken: number): string {
  if (timesSpoken >= 2 && bestScore >= 0.85 && latestScore >= 0.75) return 'Mastered';
  if (bestScore >= 0.6 || latestScore >= 0.6) return 'Developing';
  if (timesSpoken > 0) return 'Attempted';
  return 'NotStarted';
}

export function recordAttempt(data: {
  studentId: number;
  cycleId: number;
  bookId: number;
  practiceTaskId: number;
  audioPath?: string;
  rawTranscript?: string;
  targetMatchScore: number;
  pronunciationScore: number;
  fluencyScore: number;
  completenessScore: number;
  consistencyScore: number;
  compositeScore: number;
  metricsJson?: string;
}) {
  const row = db
    .insert(attempts)
    .values({
      ...data,
      timestamp: new Date().toISOString(),
    })
    .returning()
    .get();

  // Update word mastery
  const task = db
    .select()
    .from(practiceTasks)
    .where(eq(practiceTasks.id, data.practiceTaskId))
    .get();

  if (task?.vocabularyItemId) {
    const existing = db
      .select()
      .from(wordMasteryRecords)
      .where(
        and(
          eq(wordMasteryRecords.studentId, data.studentId),
          eq(wordMasteryRecords.vocabularyItemId, task.vocabularyItemId),
          eq(wordMasteryRecords.cycleId, data.cycleId)
        )
      )
      .get();

    if (existing) {
      const newBest = Math.max(existing.bestScore, data.compositeScore);
      const newTimesSpoken = existing.timesSpoken + 1;
      const status = masteryStatusFor(newBest, data.compositeScore, newTimesSpoken);

      db.update(wordMasteryRecords)
        .set({
          timesSpoken: newTimesSpoken,
          bestScore: newBest,
          latestScore: data.compositeScore,
          masteryStatus: status,
        })
        .where(
          and(
            eq(wordMasteryRecords.studentId, data.studentId),
            eq(wordMasteryRecords.vocabularyItemId, task.vocabularyItemId),
            eq(wordMasteryRecords.cycleId, data.cycleId)
          )
        )
        .run();
    } else {
      const status = masteryStatusFor(data.compositeScore, data.compositeScore, 1);

      db.insert(wordMasteryRecords)
        .values({
          studentId: data.studentId,
          vocabularyItemId: task.vocabularyItemId,
          cycleId: data.cycleId,
          timesSeen: 1,
          timesSpoken: 1,
          bestScore: data.compositeScore,
          latestScore: data.compositeScore,
          masteryStatus: status,
        })
        .run();
    }
  }

  return row;
}

export function getWordMastery(studentId: number, cycleId: number) {
  const records = db
    .select()
    .from(wordMasteryRecords)
    .where(
      and(
        eq(wordMasteryRecords.studentId, studentId),
        eq(wordMasteryRecords.cycleId, cycleId)
      )
    )
    .all();

  const vocabIds = records.map((r) => r.vocabularyItemId);
  const cycle = db.select().from(cycles).where(eq(cycles.id, cycleId)).get();
  const vocabList = vocabIds.length
    ? db
        .select()
        .from(vocabularyItems)
        .where(eq(vocabularyItems.bookId, cycle?.bookId ?? 0))
        .all()
    : [];

  return records.map((r) => ({
    ...r,
    vocabulary: vocabList.find((v) => v.id === r.vocabularyItemId),
  }));
}
