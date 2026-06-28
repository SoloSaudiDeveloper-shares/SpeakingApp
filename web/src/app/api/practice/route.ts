import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCurrentCycle, getStudentAttempts, getWordMastery } from '@/lib/actions/practice-actions';
import { getEffectiveStageConfig, getDefaultStageConfig } from '@/lib/actions/stage-config-actions';
import { db, sqlite } from '@/lib/db';
import { students } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    // Non-student roles (admin, teacher) just get an empty payload — the
    // practice page handles this and shows a friendly "no active cycle" message.
    if (!user.studentId) {
      return Response.json({
        cycle: null,
        book: null,
        vocabulary: [],
        tasks: [],
        attempts: [],
        mastery: [],
        notAStudent: true,
        stageConfig: getDefaultStageConfig(),
      });
    }

    const cycleData = getCurrentCycle(user.studentId);
    const stageConfig = getEffectiveStageConfig(user.studentId);

    if (!cycleData) {
      return Response.json({ cycle: null, attempts: [], mastery: [], stageConfig });
    }

    const studentAttempts = getStudentAttempts(user.studentId, cycleData.cycle.id);
    const mastery = getWordMastery(user.studentId, cycleData.cycle.id);
    const student = db.select().from(students).where(eq(students.id, user.studentId)).get();
    const klpRows = sqlite.prepare(`
      SELECT
        pt.vocabulary_item_id AS vocabularyItemId,
        kc.id AS klpId,
        kc.concept_id AS conceptId,
        kc.book,
        kc.lesson,
        kc.domain,
        kc.base_item AS baseItem,
        kc.subtype,
        kc.support_status AS supportStatus
      FROM practice_tasks pt
      INNER JOIN practice_task_klps ptk ON ptk.practice_task_id = pt.id
      INNER JOIN klp_concepts kc ON kc.id = ptk.klp_concept_id
      WHERE pt.book_id = ? AND pt.vocabulary_item_id IS NOT NULL
    `).all(cycleData.cycle.bookId) as Array<{
      vocabularyItemId: number;
      klpId: number;
      conceptId: string;
      book: string | null;
      lesson: string | null;
      domain: string;
      baseItem: string | null;
      subtype: string | null;
      supportStatus: string;
    }>;
    const klpByVocab = new Map<number, typeof klpRows>();
    for (const row of klpRows) {
      const list = klpByVocab.get(row.vocabularyItemId) ?? [];
      list.push(row);
      klpByVocab.set(row.vocabularyItemId, list);
    }
    let diagnostic = null;
    if (student?.diagnosticJson) {
      try {
        diagnostic = JSON.parse(student.diagnosticJson);
      } catch {
        diagnostic = null;
      }
    }

    return Response.json({
      ...cycleData,
      vocabulary: cycleData.vocabulary.map((item) => ({
        ...item,
        klpLinks: (klpByVocab.get(item.id) ?? []).map((row) => ({
          id: row.klpId,
          conceptId: row.conceptId,
          book: row.book,
          lesson: row.lesson,
          domain: row.domain,
          label: row.subtype || row.baseItem || row.conceptId,
          supportStatus: row.supportStatus,
        })),
      })),
      attempts: studentAttempts,
      mastery,
      student: {
        id: user.studentId,
        displayName: user.displayName,
        cefrBand: student?.cefrBand ?? cycleData.book?.cefrLevel ?? 'A1',
        diagnosticJson: student?.diagnosticJson ?? null,
        onboardedAt: student?.onboardedAt ?? null,
      },
      diagnostic,
      stageConfig,
    });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
