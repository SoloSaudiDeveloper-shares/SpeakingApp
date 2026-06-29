import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCurrentCycle, getStudentAttempts, getWordMastery } from '@/lib/actions/practice-actions';
import { getEffectiveStageConfig, getDefaultStageConfig } from '@/lib/actions/stage-config-actions';
import { db, sqlite } from '@/lib/db';
import { students } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

type PracticePathItem = {
  title: string;
  href: string;
  reason: string;
};

const LEGACY_PRACTICE_PATH_ITEMS: Record<string, PracticePathItem> = {
  repeat: {
    title: 'Repeat practice',
    href: '/practice?stage=repeat',
    reason: 'Build clearer sound imitation first.',
  },
  'read aloud': {
    title: 'Read aloud',
    href: '/practice?stage=read-aloud',
    reason: 'Practice full-word decoding with visible text.',
  },
  sentence: {
    title: 'Sentence practice',
    href: '/practice?stage=sentence',
    reason: 'Build complete sentences before open speech.',
  },
  'free speak': {
    title: 'Free Speak',
    href: '/practice?stage=free-speak',
    reason: 'Use vocabulary in your own sentence.',
  },
  scenario: {
    title: 'Scenario practice',
    href: '/practice/conversation?mode=scenarios',
    reason: 'Practice target language in a guided conversation.',
  },
};

function normalizePracticePathItem(value: unknown): PracticePathItem | null {
  if (typeof value === 'string') {
    return LEGACY_PRACTICE_PATH_ITEMS[value.trim().toLowerCase()] ?? null;
  }
  if (!value || typeof value !== 'object') return null;

  const item = value as Record<string, unknown>;
  if (typeof item.title !== 'string' || typeof item.href !== 'string') return null;
  return {
    title: item.title,
    href: item.href,
    reason: typeof item.reason === 'string' ? item.reason : 'Continue your recommended practice path.',
  };
}

function normalizeDiagnostic(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const diagnostic = { ...(value as Record<string, unknown>) };
  if (Array.isArray(diagnostic.recommendedPracticePath)) {
    diagnostic.recommendedPracticePath = diagnostic.recommendedPracticePath
      .map(normalizePracticePathItem)
      .filter((item): item is PracticePathItem => item !== null);
  }
  return diagnostic;
}

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
        diagnostic = normalizeDiagnostic(JSON.parse(student.diagnosticJson));
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
