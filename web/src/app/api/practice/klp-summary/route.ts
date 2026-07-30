import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCurrentCycle } from '@/lib/actions/practice-actions';
import { getKlpOverview, isKlpEnabled } from '@/lib/actions/klp-actions';
import { getKlpAssignmentsForStudent } from '@/lib/actions/homework-actions';
import { pool } from '@/lib/db';

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

    const enabled = await isKlpEnabled();
    if (!enabled) return Response.json({ enabled: false });

    const cycleData = await getCurrentCycle(user.studentId);
    const overview = await getKlpOverview();
    const assignments = await getKlpAssignmentsForStudent(user.studentId);
    const linked = (await pool.query<Row>(`
      SELECT
        kc.book,
        kc.lesson,
        COUNT(DISTINCT ptk.practice_task_id)::int AS "linkedTasks",
        COUNT(DISTINCT akr.klp_concept_id)::int AS "practicedConcepts"
      FROM practice_task_klps ptk
      INNER JOIN klp_concepts kc ON kc.id = ptk.klp_concept_id
      LEFT JOIN attempt_klp_results akr
        ON akr.klp_concept_id = kc.id
        AND akr.student_id = $1
      GROUP BY kc.book, kc.lesson
      ORDER BY NULLIF(regexp_replace(kc.book, '\\D', '', 'g'), '')::integer NULLS LAST,
        NULLIF(regexp_replace(kc.lesson, '\\D', '', 'g'), '')::integer NULLS LAST
      LIMIT 5
    `, [user.studentId])).rows;

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
