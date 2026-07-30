import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCurrentCycle, getStudentAttempts, getWordMastery } from '@/lib/actions/practice-actions';
import { db } from '@/lib/db';
import { students } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/students/[id]/progress
 * Admin/Teacher: returns a student's profile + attempts + word mastery for
 * their current cycle. Powers the Progress Report page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (user.role !== 'Admin' && user.role !== 'Teacher') {
      return Response.json({ error: 'Not authorized.' }, { status: 403 });
    }

    const { id } = await params;
    const studentId = Number(id);

    const student = ((await db.select().from(students).where(eq(students.id, studentId)).limit(1))[0]);
    if (!student) return Response.json({ error: 'Student not found.' }, { status: 404 });

    const cycleData = await getCurrentCycle(studentId);
    let attempts: Awaited<ReturnType<typeof getStudentAttempts>> = [];
    let mastery: Awaited<ReturnType<typeof getWordMastery>> = [];
    if (cycleData) {
      attempts = await getStudentAttempts(studentId, cycleData.cycle.id);
      mastery = await getWordMastery(studentId, cycleData.cycle.id);
    }

    return Response.json({
      student: {
        id: student.id,
        fullName: student.fullName,
        cefrBand: student.cefrBand,
        class: student.class,
        uniqueNumber: student.uniqueNumber,
      },
      cycle: cycleData?.cycle ?? null,
      attempts,
      mastery,
    });
  } catch (e) {
    console.error('Student progress error:', e);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
