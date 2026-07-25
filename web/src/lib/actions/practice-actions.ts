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

export async function getCurrentCycle(studentId: number) {
  const enrollment = (await db
    .select()
    .from(studentCycles)
    .where(eq(studentCycles.studentId, studentId)));

  if (enrollment.length === 0) return null;

  const latestEnrollment = enrollment[enrollment.length - 1];
  const cycle = ((await db
    .select()
    .from(cycles)
    .where(eq(cycles.id, latestEnrollment.cycleId)).limit(1))[0]);

  if (!cycle) return null;

  const book = ((await db
    .select()
    .from(books)
    .where(eq(books.id, cycle.bookId)).limit(1))[0]);

  const vocab = (await db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.bookId, cycle.bookId)));

  const tasks = (await db
    .select()
    .from(practiceTasks)
    .where(eq(practiceTasks.bookId, cycle.bookId)));

  return { cycle, book, vocabulary: vocab, tasks, enrollment: latestEnrollment };
}

export async function getStudentAttempts(studentId: number, cycleId: number) {
  return (await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.studentId, studentId), eq(attempts.cycleId, cycleId)))
    .orderBy(desc(attempts.timestamp)));
}

export function masteryStatusFor(bestScore: number, latestScore: number, timesSpoken: number): string {
  if (timesSpoken >= 2 && bestScore >= 0.85 && latestScore >= 0.75) return 'Mastered';
  if (bestScore >= 0.6 || latestScore >= 0.6) return 'Developing';
  if (timesSpoken > 0) return 'Attempted';
  return 'NotStarted';
}

export async function recordAttempt(data: {
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
  const row = ((await db
    .insert(attempts)
    .values({
      ...data,
      timestamp: new Date().toISOString(),
    })
    .returning())[0]);

  // Update word mastery
  const task = ((await db
    .select()
    .from(practiceTasks)
    .where(eq(practiceTasks.id, data.practiceTaskId)).limit(1))[0]);

  if (task?.vocabularyItemId) {
    const existing = ((await db
      .select()
      .from(wordMasteryRecords)
      .where(
        and(
          eq(wordMasteryRecords.studentId, data.studentId),
          eq(wordMasteryRecords.vocabularyItemId, task.vocabularyItemId),
          eq(wordMasteryRecords.cycleId, data.cycleId)
        )
      ).limit(1))[0]);

    if (existing) {
      const newBest = Math.max(existing.bestScore, data.compositeScore);
      const newTimesSpoken = existing.timesSpoken + 1;
      const status = masteryStatusFor(newBest, data.compositeScore, newTimesSpoken);

      (await db.update(wordMasteryRecords)
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
        ));
    } else {
      const status = masteryStatusFor(data.compositeScore, data.compositeScore, 1);

      (await db.insert(wordMasteryRecords)
        .values({
          studentId: data.studentId,
          vocabularyItemId: task.vocabularyItemId,
          cycleId: data.cycleId,
          timesSeen: 1,
          timesSpoken: 1,
          bestScore: data.compositeScore,
          latestScore: data.compositeScore,
          masteryStatus: status,
        }));
    }
  }

  return row;
}

export async function getWordMastery(studentId: number, cycleId: number) {
  const records = (await db
    .select()
    .from(wordMasteryRecords)
    .where(
      and(
        eq(wordMasteryRecords.studentId, studentId),
        eq(wordMasteryRecords.cycleId, cycleId)
      )
    ));

  const vocabIds = records.map((r) => r.vocabularyItemId);
  const cycle = ((await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1))[0]);
  const vocabList = vocabIds.length
    ? (await db
        .select()
        .from(vocabularyItems)
        .where(eq(vocabularyItems.bookId, cycle?.bookId ?? 0)))
    : [];

  return records.map((r) => ({
    ...r,
    vocabulary: vocabList.find((v) => v.id === r.vocabularyItemId),
  }));
}
