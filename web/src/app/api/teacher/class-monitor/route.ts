import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { db } from '@/lib/db';
import { attempts, students, vocabularyItems, practiceTasks } from '@/lib/db/schema';
import { desc, gte, eq } from 'drizzle-orm';

/**
 * GET /api/teacher/class-monitor?windowMs=60000
 *
 * Returns students who have made an attempt within the time window.
 * Default window: 60 seconds (= "currently active").
 */
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher')) {
      return Response.json({ error: 'Not authorized.' }, { status: 403 });
    }

    const url = new URL(request.url);
    const windowMs = Number(url.searchParams.get('windowMs') ?? 60_000);
    const cutoff = new Date(Date.now() - windowMs).toISOString();

    // Get recent attempts joined with student, practiceTask, word
    const recent = db
      .select({
        attemptId: attempts.id,
        studentId: attempts.studentId,
        studentName: students.fullName,
        className: students.class,
        cefr: students.cefrBand,
        score: attempts.compositeScore,
        transcript: attempts.rawTranscript,
        timestamp: attempts.timestamp,
        word: vocabularyItems.word,
        taskType: practiceTasks.taskType,
      })
      .from(attempts)
      .leftJoin(students, eq(students.id, attempts.studentId))
      .leftJoin(practiceTasks, eq(practiceTasks.id, attempts.practiceTaskId))
      .leftJoin(vocabularyItems, eq(vocabularyItems.id, practiceTasks.vocabularyItemId))
      .where(gte(attempts.timestamp, cutoff))
      .orderBy(desc(attempts.timestamp))
      .all();

    // Group by student — keep only their most recent attempt
    const byStudent = new Map<number, typeof recent[number]>();
    for (const a of recent) {
      if (a.studentId !== null && !byStudent.has(a.studentId)) {
        byStudent.set(a.studentId, a);
      }
    }

    const activeStudents = Array.from(byStudent.values()).map((a) => ({
      studentId: a.studentId,
      name: a.studentName,
      class: a.className,
      cefr: a.cefr,
      lastWord: a.word,
      lastTaskType: a.taskType,
      lastScore: a.score,
      lastTranscript: a.transcript,
      lastActiveAt: a.timestamp,
    }));

    return Response.json({
      activeStudents,
      totalActive: activeStudents.length,
      windowMs,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Class monitor error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
