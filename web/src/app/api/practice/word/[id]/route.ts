import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { db } from '@/lib/db';
import { vocabularyItems, attempts, practiceTasks, wordMasteryRecords } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const { id } = await params;
    const vocabId = parseInt(id, 10);
    if (isNaN(vocabId)) return Response.json({ error: 'Invalid word ID.' }, { status: 400 });

    const vocab = db.select().from(vocabularyItems).where(eq(vocabularyItems.id, vocabId)).get();
    if (!vocab) return Response.json({ error: 'Word not found.' }, { status: 404 });

    // Get all tasks for this vocabulary item
    const tasks = db
      .select()
      .from(practiceTasks)
      .where(eq(practiceTasks.vocabularyItemId, vocabId))
      .all();

    const taskIds = tasks.map((t) => t.id);

    // Get all attempts for these tasks by this student
    const wordAttempts = taskIds.length
      ? db
          .select()
          .from(attempts)
          .where(eq(attempts.studentId, user.studentId))
          .orderBy(desc(attempts.timestamp))
          .all()
          .filter((a) => taskIds.includes(a.practiceTaskId))
      : [];

    // Get mastery records for this word
    const mastery = db
      .select()
      .from(wordMasteryRecords)
      .where(
        and(
          eq(wordMasteryRecords.studentId, user.studentId),
          eq(wordMasteryRecords.vocabularyItemId, vocabId)
        )
      )
      .all();

    return Response.json({ vocabulary: vocab, attempts: wordAttempts, mastery: mastery[0] ?? null });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
