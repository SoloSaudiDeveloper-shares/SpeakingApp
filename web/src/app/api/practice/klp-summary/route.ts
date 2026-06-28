import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCurrentCycle } from '@/lib/actions/practice-actions';
import { getKlpOverview, isKlpEnabled } from '@/lib/actions/klp-actions';
import { getKlpAssignmentsForStudent } from '@/lib/actions/homework-actions';
import { sqlite } from '@/lib/db';

interface Row {
  book: string | null;
  lesson: string | null;
  linkedTasks: number;
  practicedConcepts: number;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ enabled: false, notAStudent: true });

    const enabled = isKlpEnabled();
    if (!enabled) return Response.json({ enabled: false });

    const cycleData = getCurrentCycle(user.studentId);
    const overview = getKlpOverview();
    const assignments = getKlpAssignmentsForStudent(user.studentId);
    const linked = sqlite.prepare(`
      SELECT
        kc.book,
        kc.lesson,
        COUNT(DISTINCT ptk.practice_task_id) AS linkedTasks,
        COUNT(DISTINCT akr.klp_concept_id) AS practicedConcepts
      FROM practice_task_klps ptk
      INNER JOIN klp_concepts kc ON kc.id = ptk.klp_concept_id
      LEFT JOIN attempt_klp_results akr
        ON akr.klp_concept_id = kc.id
        AND akr.student_id = ?
      GROUP BY kc.book, kc.lesson
      ORDER BY CAST(kc.book AS INTEGER), CAST(kc.lesson AS INTEGER)
      LIMIT 5
    `).all(user.studentId) as Row[];

    return Response.json({
      enabled: true,
      overview,
      activeCycle: cycleData ? {
        cycleId: cycleData.cycle.id,
        bookTitle: cycleData.book?.title ?? null,
        cefrLevel: cycleData.book?.cefrLevel ?? null,
        vocabularyCount: cycleData.vocabulary.length,
        taskCount: cycleData.tasks.length,
      } : null,
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        dueDate: assignment.dueDate,
        targetType: assignment.targetType,
        taskTypes: assignment.taskTypes,
        klpIds: assignment.klpIds,
        scenarioIds: assignment.scenarioIds,
        klps: assignment.klps.map((klp) => ({
          id: klp?.id,
          conceptId: klp?.conceptId,
          book: klp?.book ?? null,
          lesson: klp?.lesson ?? null,
          domain: klp?.domain,
          label: klp?.subtype || klp?.baseItem || klp?.conceptId,
          supportStatus: klp?.supportStatus,
        })),
        scenarios: assignment.scenarios.map((scenario) => ({
          scenarioId: scenario?.scenarioId,
          title: scenario?.title,
          description: scenario?.description,
          cefrLevel: scenario?.cefrLevel,
          status: scenario?.status,
        })),
      })),
      focus: linked.map((row) => ({
        book: row.book,
        lesson: row.lesson,
        linkedTasks: Number(row.linkedTasks),
        practicedConcepts: Number(row.practicedConcepts),
      })),
    });
  } catch (error) {
    console.error('practice klp summary error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
