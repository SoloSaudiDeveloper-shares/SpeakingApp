import { db } from '../db';
import { spacedRepetitionQueue, vocabularyItems } from '../db/schema';
import { eq, and, lte } from 'drizzle-orm';

export async function getReviewQueue(studentId: number, cycleId: number) {
  const today = new Date().toISOString().split('T')[0];

  const queue = (await db
    .select({
      id: spacedRepetitionQueue.id,
      studentId: spacedRepetitionQueue.studentId,
      vocabularyItemId: spacedRepetitionQueue.vocabularyItemId,
      cycleId: spacedRepetitionQueue.cycleId,
      interval: spacedRepetitionQueue.interval,
      easeFactor: spacedRepetitionQueue.easeFactor,
      repetitions: spacedRepetitionQueue.repetitions,
      nextReviewDate: spacedRepetitionQueue.nextReviewDate,
      lastReviewDate: spacedRepetitionQueue.lastReviewDate,
      word: vocabularyItems.word,
      arabicMeaning: vocabularyItems.arabicMeaning,
      exampleSentence: vocabularyItems.exampleSentence,
    })
    .from(spacedRepetitionQueue)
    .innerJoin(
      vocabularyItems,
      eq(spacedRepetitionQueue.vocabularyItemId, vocabularyItems.id)
    )
    .where(
      and(
        eq(spacedRepetitionQueue.studentId, studentId),
        eq(spacedRepetitionQueue.cycleId, cycleId),
        lte(spacedRepetitionQueue.nextReviewDate, today)
      )
    ));

  return queue;
}

/**
 * SM-2 algorithm: process a review and update the spaced repetition queue.
 * score is a composite score from 0 to 1.
 */
export async function processReview(
  studentId: number,
  vocabularyItemId: number,
  cycleId: number,
  score: number
) {
  const today = new Date().toISOString().split('T')[0];

  const item = ((await db
    .select()
    .from(spacedRepetitionQueue)
    .where(
      and(
        eq(spacedRepetitionQueue.studentId, studentId),
        eq(spacedRepetitionQueue.vocabularyItemId, vocabularyItemId),
        eq(spacedRepetitionQueue.cycleId, cycleId)
      )
    ).limit(1))[0]);

  if (!item) return null;

  let { interval, easeFactor, repetitions } = item;

  if (score >= 0.8) {
    // Good recall: increase interval
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions++;
    // Increase ease factor (SM-2 formula component)
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - score * 5) * (0.08 + (5 - score * 5) * 0.02));
  } else if (score >= 0.5) {
    // Partial recall: reset interval, slight ease decrease
    interval = 1;
    repetitions = 0;
    easeFactor = Math.max(1.3, easeFactor - 0.15);
  } else {
    // Poor recall: reset interval, larger ease decrease
    interval = 1;
    repetitions = 0;
    easeFactor = Math.max(1.3, easeFactor - 0.3);
  }

  // Calculate next review date
  const nextDate = new Date(today);
  nextDate.setDate(nextDate.getDate() + interval);
  const nextReviewDate = nextDate.toISOString().split('T')[0];

  (await db.update(spacedRepetitionQueue)
    .set({
      interval,
      easeFactor,
      repetitions,
      nextReviewDate,
      lastReviewDate: today,
    })
    .where(eq(spacedRepetitionQueue.id, item.id)));

  return {
    id: item.id,
    interval,
    easeFactor,
    repetitions,
    nextReviewDate,
    lastReviewDate: today,
  };
}

export async function initializeQueue(
  studentId: number,
  cycleId: number,
  vocabularyItemIds: number[]
) {
  const today = new Date().toISOString().split('T')[0];
  const added: number[] = [];

  for (const vocabId of vocabularyItemIds) {
    // Check if already in queue
    const existing = ((await db
      .select()
      .from(spacedRepetitionQueue)
      .where(
        and(
          eq(spacedRepetitionQueue.studentId, studentId),
          eq(spacedRepetitionQueue.vocabularyItemId, vocabId),
          eq(spacedRepetitionQueue.cycleId, cycleId)
        )
      ).limit(1))[0]);

    if (!existing) {
      (await db.insert(spacedRepetitionQueue)
        .values({
          studentId,
          vocabularyItemId: vocabId,
          cycleId,
          interval: 1,
          easeFactor: 2.5,
          repetitions: 0,
          nextReviewDate: today,
        }));
      added.push(vocabId);
    }
  }

  return added;
}
