import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { overrideAttemptScore } from '@/lib/actions/teacher-actions';
import { db } from '@/lib/db';
import { attempts, practiceTasks, students, vocabularyItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher'))
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    const { id } = await params;
    const attemptId = parseInt(id, 10);
    if (isNaN(attemptId)) return Response.json({ error: 'Invalid attempt ID.' }, { status: 400 });

    const attempt = ((await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1))[0]);
    if (!attempt) return Response.json({ error: 'Attempt not found.' }, { status: 404 });

    const task = ((await db.select().from(practiceTasks).where(eq(practiceTasks.id, attempt.practiceTaskId)).limit(1))[0]);
    const student = ((await db.select().from(students).where(eq(students.id, attempt.studentId)).limit(1))[0]);
    const vocab = task?.vocabularyItemId
      ? ((await db.select().from(vocabularyItems).where(eq(vocabularyItems.id, task.vocabularyItemId)).limit(1))[0])
      : null;

    return Response.json({ attempt, task, student, vocabulary: vocab });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher'))
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    const { id } = await params;
    const attemptId = parseInt(id, 10);
    if (isNaN(attemptId)) return Response.json({ error: 'Invalid attempt ID.' }, { status: 400 });

    const body = await request.json();
    const score = typeof body.score === 'number' ? body.score : parseFloat(body.score);
    const notes = body.notes ?? '';

    if (isNaN(score) || score < 0 || score > 1)
      return Response.json({ error: 'Score must be between 0 and 1.' }, { status: 400 });

    await overrideAttemptScore(attemptId, score, notes);

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
