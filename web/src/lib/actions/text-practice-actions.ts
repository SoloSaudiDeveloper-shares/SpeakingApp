import { db } from '../db';
import { studentTexts, textAttempts, studentWordLists } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export async function saveText(
  studentId: number,
  title: string,
  originalText: string,
  summary?: string
) {
  const wordCount = originalText.split(/\s+/).filter(Boolean).length;
  const now = new Date().toISOString();
  return ((await db
    .insert(studentTexts)
    .values({
      studentId,
      title,
      originalText,
      summary: summary ?? null,
      wordCount,
      createdAt: now,
    })
    .returning())[0]);
}

export async function getStudentTexts(studentId: number) {
  return (await db
    .select()
    .from(studentTexts)
    .where(eq(studentTexts.studentId, studentId))
    .orderBy(desc(studentTexts.createdAt)));
}

export async function getTextById(id: number) {
  const text = ((await db
    .select()
    .from(studentTexts)
    .where(eq(studentTexts.id, id)).limit(1))[0]);

  if (!text) return null;

  const attempts = (await db
    .select()
    .from(textAttempts)
    .where(eq(textAttempts.studentTextId, id))
    .orderBy(desc(textAttempts.attemptedAt)));

  return { ...text, attempts };
}

export async function recordTextAttempt(data: {
  studentTextId: number;
  studentId: number;
  spokenTranscript: string;
  accuracyScore: number;
  pronunciationScore: number;
  fluencyScore: number;
  completenessScore: number;
  weakWords: string[];
  durationSeconds: number;
}) {
  const now = new Date().toISOString();
  const result = ((await db
    .insert(textAttempts)
    .values({
      studentTextId: data.studentTextId,
      studentId: data.studentId,
      spokenTranscript: data.spokenTranscript,
      accuracyScore: data.accuracyScore,
      pronunciationScore: data.pronunciationScore,
      fluencyScore: data.fluencyScore,
      completenessScore: data.completenessScore,
      weakWords: JSON.stringify(data.weakWords),
      attemptedAt: now,
      durationSeconds: data.durationSeconds,
    })
    .returning())[0]);

  // Update lastPracticedAt on the text
  (await db.update(studentTexts)
    .set({ lastPracticedAt: now })
    .where(eq(studentTexts.id, data.studentTextId)));

  return result;
}

export async function getTextAttempts(studentTextId: number) {
  return (await db
    .select()
    .from(textAttempts)
    .where(eq(textAttempts.studentTextId, studentTextId))
    .orderBy(desc(textAttempts.attemptedAt)));
}

export async function saveWordList(studentId: number, name: string, words: Array<{ word: string; meaning?: string; fromTextId?: number }>) {
  const now = new Date().toISOString();
  return ((await db
    .insert(studentWordLists)
    .values({
      studentId,
      name,
      words: JSON.stringify(words),
      createdAt: now,
    })
    .returning())[0]);
}

export async function getStudentWordLists(studentId: number) {
  return (await db
    .select()
    .from(studentWordLists)
    .where(eq(studentWordLists.studentId, studentId))
    .orderBy(desc(studentWordLists.createdAt)));
}

export async function deleteText(id: number) {
  (await db.delete(studentTexts).where(eq(studentTexts.id, id)));
}

export async function deleteWordList(id: number) {
  (await db.delete(studentWordLists).where(eq(studentWordLists.id, id)));
}
