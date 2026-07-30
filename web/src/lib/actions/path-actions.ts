import { pool } from '@/lib/db';
import { getHomeworkForStudent, type HomeworkAssignmentView, type HomeworkPathConfig } from './homework-actions';

export type PathStageKey = 'listen-repeat' | 'context' | 'original' | 'controlled-dialogue' | 'open-scenario';
export type PathStageStatus = 'locked' | 'available' | 'in-progress' | 'complete';

export interface LearnerPathStage {
  key: PathStageKey;
  number: number;
  title: string;
  description: string;
  status: PathStageStatus;
  completed: number;
  required: number;
  href: string | null;
}

export interface LearnerAssignmentPath {
  assignmentId: number;
  title: string;
  description: string | null;
  dueDate: string;
  legacy: boolean;
  complete: boolean;
  progressPercent: number;
  targetWords: Array<{ id: number; word: string; exampleSentence: string | null }>;
  stages: LearnerPathStage[];
}

const STAGES: Array<Pick<LearnerPathStage, 'key' | 'title' | 'description'>> = [
  { key: 'listen-repeat', title: 'Listen and repeat', description: 'Hear and repeat every lesson target.' },
  { key: 'context', title: 'Use it in context', description: 'Read each target in its supplied sentence.' },
  { key: 'original', title: 'Make your own sentence', description: 'Create an original sentence for every target.' },
  { key: 'controlled-dialogue', title: 'Controlled mini-dialogue', description: 'Use the targets in a guided exchange.' },
  { key: 'open-scenario', title: 'Open scenario', description: 'Use the lesson language in a freer role-play.' },
];

async function targetIds(assignment: HomeworkAssignmentView, config: HomeworkPathConfig): Promise<number[]> {
  if (config.targetWordIds.length) return config.targetWordIds;
  if (assignment.wordIds.length) return assignment.wordIds;
  if (!assignment.klpIds.length) return [];
  const result = await pool.query<{ id: number }>(`
    SELECT DISTINCT vi.id
    FROM klp_concepts kc
    JOIN cycles c ON c.id = $1
    JOIN vocabulary_items vi ON vi.book_id = c.book_id AND lower(trim(vi.word)) = lower(trim(kc.base_item))
    WHERE kc.id = ANY($2::int[])
  `, [assignment.cycleId, assignment.klpIds]);
  return result.rows.map((row) => Number(row.id));
}

async function wordProgress(studentId: number, cycleId: number, wordIds: number[], taskTypes: string[]) {
  if (!wordIds.length) return { complete: 0, required: 0, completedItems: [] as number[] };
  const normalized = taskTypes.map((type) => type.toLowerCase());
  const result = await pool.query<{ wordId: number; passed: boolean }>(`
    SELECT vi.id AS "wordId",
      MAX(CASE WHEN a.composite_score >= pt.pass_score THEN 1 ELSE 0 END) AS passed
    FROM vocabulary_items vi
    LEFT JOIN practice_tasks pt ON pt.vocabulary_item_id = vi.id AND lower(pt.task_type) = ANY($1::text[])
    LEFT JOIN attempts a ON a.practice_task_id = pt.id AND a.student_id = $2 AND a.cycle_id = $3
    WHERE vi.id = ANY($4::int[])
    GROUP BY vi.id
  `, [normalized, studentId, cycleId, wordIds]);
  const completedItems = result.rows.filter((row) => Boolean(row.passed)).map((row) => Number(row.wordId));
  return { complete: completedItems.length, required: wordIds.length, completedItems };
}

async function scenarioProgress(studentId: number, scenarioId: string | null) {
  if (!scenarioId) return { complete: 0, required: 1, completedItems: [] as string[] };
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM scenario_attempts WHERE student_id = $1 AND scenario_id = $2 AND score >= 75 ORDER BY id DESC LIMIT 1`,
    [studentId, scenarioId],
  );
  const row = result.rows[0];
  return { complete: row ? 1 : 0, required: 1, completedItems: row ? [scenarioId] : [] };
}

async function persistProgress(homeworkId: number, studentId: number, stage: LearnerPathStage, completedItems: Array<number | string>) {
  const now = new Date().toISOString();
  await pool.query(`
    INSERT INTO homework_path_progress(homework_id, student_id, stage_key, status, completed_items_json, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT(homework_id, student_id, stage_key) DO UPDATE SET
      status = excluded.status, completed_items_json = excluded.completed_items_json, updated_at = excluded.updated_at
  `, [homeworkId, studentId, stage.key, stage.status, JSON.stringify(completedItems), now]);
}

async function buildConfiguredPath(studentId: number, assignment: HomeworkAssignmentView): Promise<LearnerAssignmentPath> {
  const config = assignment.pathConfig!;
  const ids = await targetIds(assignment, config);
  const words = ids.length
    ? (await pool.query<LearnerAssignmentPath['targetWords'][number]>(
        `SELECT id, word, example_sentence AS "exampleSentence" FROM vocabulary_items WHERE id = ANY($1::int[]) ORDER BY sort_order, id`,
        [ids],
      )).rows
    : [];
  const results = await Promise.all([
    wordProgress(studentId, assignment.cycleId, ids, ['listenrepeat', 'repeat']),
    wordProgress(studentId, assignment.cycleId, ids, ['sentenceframe', 'sentence']),
    wordProgress(studentId, assignment.cycleId, ids, ['freerecall', 'free-speak']),
    scenarioProgress(studentId, config.controlledScenarioId),
    scenarioProgress(studentId, config.openScenarioId),
  ]);
  let previousComplete = true;
  const stages: LearnerPathStage[] = [];
  for (const [index, meta] of STAGES.entries()) {
    const result = results[index];
    const complete = result.required > 0 && result.complete >= result.required;
    const status: PathStageStatus = complete ? 'complete' : previousComplete ? (result.complete > 0 ? 'in-progress' : 'available') : 'locked';
    previousComplete = previousComplete && complete;
    const params = new URLSearchParams({ assignmentId: String(assignment.id), pathStage: meta.key });
    let href: string | null = null;
    const completedWordIds = index < 3 ? new Set(result.completedItems as number[]) : null;
    const nextWord = completedWordIds
      ? ids.find((id) => !completedWordIds.has(id)) ?? words[0]?.id
      : undefined;
    if (index < 3 && nextWord) {
      params.set('stage', index === 0 ? 'repeat' : index === 1 ? 'sentence' : 'free-speak');
      params.set('wordId', String(nextWord));
      href = `/practice?${params.toString()}`;
    } else {
      const scenarioId = index === 3 ? config.controlledScenarioId : config.openScenarioId;
      if (scenarioId) {
        params.set('mode', 'scenarios');
        params.set('scenarioId', scenarioId);
        href = `/practice/conversation?${params.toString()}`;
      }
    }
    const stage = { ...meta, number: index + 1, status, completed: result.complete, required: result.required, href: status === 'locked' ? null : href };
    await persistProgress(assignment.id, studentId, stage, result.completedItems);
    stages.push(stage);
  }
  const completeCount = stages.filter((stage) => stage.status === 'complete').length;
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    description: assignment.description,
    dueDate: assignment.dueDate,
    legacy: false,
    complete: completeCount === stages.length,
    progressPercent: Math.round((completeCount / stages.length) * 100),
    targetWords: words,
    stages,
  };
}

export async function getLearnerPaths(studentId: number) {
  const assignmentRows = await getHomeworkForStudent(studentId, '');
  const paths = await Promise.all(assignmentRows.map(async (assignment): Promise<LearnerAssignmentPath> => {
    if (assignment.pathConfig) return await buildConfiguredPath(studentId, assignment);
    return {
      assignmentId: assignment.id, title: assignment.title, description: assignment.description,
      dueDate: assignment.dueDate, legacy: true, complete: Boolean(assignment.submitted), progressPercent: assignment.submitted ? 100 : 0,
      targetWords: [], stages: [],
    };
  }));
  const configured = paths.filter((path) => !path.legacy);
  const activePath = configured.find((path) => !path.complete) ?? configured[0] ?? null;
  return { activePath, paths, legacyAssignments: paths.filter((path) => path.legacy) };
}
