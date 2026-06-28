import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { db } from '@/lib/db';
import {
  students,
  studentCycles,
  wordMasteryRecords,
  userAccounts,
} from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    // Get the current student's class
    const student = db
      .select()
      .from(students)
      .where(eq(students.id, user.studentId))
      .get();

    if (!student) return Response.json([], { status: 200 });

    const studentClass = student.class;

    // Get all students in the same class
    const classmates = studentClass
      ? db.select().from(students).where(eq(students.class, studentClass)).all()
      : [student];

    const classmateIds = classmates.map((s) => s.id);

    // Get the latest cycle enrollment for each student and count mastered words
    const results: Array<{ studentId: number; displayName: string; masteredCount: number }> = [];

    for (const s of classmates) {
      // Get the account display name
      const account = db
        .select()
        .from(userAccounts)
        .where(eq(userAccounts.studentId, s.id))
        .get();

      // Count mastered words across all cycles
      const masteryCount = db
        .select({ count: sql<number>`count(*)` })
        .from(wordMasteryRecords)
        .where(
          and(
            eq(wordMasteryRecords.studentId, s.id),
            eq(wordMasteryRecords.masteryStatus, 'Mastered')
          )
        )
        .get();

      results.push({
        studentId: s.id,
        displayName: account?.displayName ?? s.fullName,
        masteredCount: masteryCount?.count ?? 0,
      });
    }

    // Sort by mastered count descending, assign ranks
    results.sort((a, b) => b.masteredCount - a.masteredCount);
    const ranked = results.slice(0, 5).map((r, i) => ({
      ...r,
      rank: i + 1,
    }));

    return Response.json(ranked);
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
