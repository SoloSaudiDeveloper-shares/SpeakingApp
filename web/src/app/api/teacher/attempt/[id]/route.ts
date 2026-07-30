import {
  getAuthorizedAttempt,
  requireAuthenticated,
} from '@/lib/auth/authorization';
import { overrideAttemptScore } from '@/lib/actions/teacher-actions';
import { db } from '@/lib/db';
import { practiceTasks, students, vocabularyItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticated({ roles: ['Admin', 'Teacher'] });
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const attemptId = parseInt(id, 10);
    if (isNaN(attemptId)) return Response.json({ error: 'Invalid attempt ID.' }, { status: 400 });

    const authorized = await getAuthorizedAttempt(auth.user, attemptId);
    if (!authorized) return Response.json({ error: 'Attempt not found.' }, { status: 404 });
    const { attempt } = authorized;

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
    const auth = await requireAuthenticated({ roles: ['Admin', 'Teacher'] });
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const attemptId = parseInt(id, 10);
    if (isNaN(attemptId)) return Response.json({ error: 'Invalid attempt ID.' }, { status: 400 });
    if (!await getAuthorizedAttempt(auth.user, attemptId)) {
      return Response.json({ error: 'Attempt not found.' }, { status: 404 });
    }

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
