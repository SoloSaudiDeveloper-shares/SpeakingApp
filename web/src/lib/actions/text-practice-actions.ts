import { db } from '../db';
import { studentTexts, textAttempts, studentWordLists } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export function saveText(
  studentId: number,
  title: string,
  originalText: string,
  summary?: string
) {
  const wordCount = originalText.split(/\s+/).filter(Boolean).length;
  const now = new Date().toISOString();
  return db
    .insert(studentTexts)
    .values({
      studentId,
      title,
      originalText,
      summary: summary ?? null,
      wordCount,
      createdAt: now,
    })
    .returning()
    .get();
}

export function getStudentTexts(studentId: number) {
  return db
    .select()
    .from(studentTexts)
    .where(eq(studentTexts.studentId, studentId))
    .orderBy(desc(studentTexts.createdAt))
    .all();
}

export function getTextById(id: number) {
  const text = db
    .select()
    .from(studentTexts)
    .where(eq(studentTexts.id, id))
    .get();

  if (!text) return null;

  const attempts = db
    .select()
    .from(textAttempts)
    .where(eq(textAttempts.studentTextId, id))
    .orderBy(desc(textAttempts.attemptedAt))
    .all();

  return { ...text, attempts };
}

export function recordTextAttempt(data: {
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
  const result = db
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
    .returning()
    .get();

  // Update lastPracticedAt on the text
  db.update(studentTexts)
    .set({ lastPracticedAt: now })
    .where(eq(studentTexts.id, data.studentTextId))
    .run();

  return result;
}

export function getTextAttempts(studentTextId: number) {
  return db
    .select()
    .from(textAttempts)
    .where(eq(textAttempts.studentTextId, studentTextId))
    .orderBy(desc(textAttempts.attemptedAt))
    .all();
}

export function saveWordList(studentId: number, name: string, words: Array<{ word: string; meaning?: string; fromTextId?: number }>) {
  const now = new Date().toISOString();
  return db
    .insert(studentWordLists)
    .values({
      studentId,
      name,
      words: JSON.stringify(words),
      createdAt: now,
    })
    .returning()
    .get();
}

export function getStudentWordLists(studentId: number) {
  return db
    .select()
    .from(studentWordLists)
    .where(eq(studentWordLists.studentId, studentId))
    .orderBy(desc(studentWordLists.createdAt))
    .all();
}

export function deleteText(id: number) {
  db.delete(studentTexts).where(eq(studentTexts.id, id)).run();
}

export function deleteWordList(id: number) {
  db.delete(studentWordLists).where(eq(studentWordLists.id, id)).run();
}
