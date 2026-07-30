import { db } from '../db';
import {
  homeworkAssignments,
  homeworkSubmissions,
  students,
  studentCycles,
  klpConcepts,
  klpGeneratedScenarios,
} from '../db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';

export type HomeworkTargetType = 'class' | 'cycle' | 'student';
export type HomeworkSource = 'manual' | 'klp';

export interface HomeworkPathConfig {
  version: 1;
  targetWordIds: number[];
  controlledScenarioId: string | null;
  openScenarioId: string | null;
  textPracticeId?: number | null;
}

export interface HomeworkAssignmentView {
  id: number;
  cycleId: number;
  createdByUserId: number;
  title: string;
  description: string | null;
  wordIds: number[];
  taskTypes: string[];
  dueDate: string;
  className: string | null;
  targetType: HomeworkTargetType;
  studentIds: number[];
  klpIds: number[];
  scenarioIds: string[];
  source: HomeworkSource;
  status: string;
  pathConfig: HomeworkPathConfig | null;
  createdAt: string;
  submitted?: boolean;
  submission?: typeof homeworkSubmissions.$inferSelect | null;
  submissionCount?: number;
  completedCount?: number;
  avgScore?: number;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanIds(ids: unknown): number[] {
  return Array.isArray(ids)
    ? ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
}

function cleanScenarioIds(ids: unknown): string[] {
  return Array.isArray(ids)
    ? ids.map((id) => String(id).trim()).filter(Boolean)
    : [];
}

function targetTypeFor(row: typeof homeworkAssignments.$inferSelect): HomeworkTargetType {
  if (row.targetType === 'cycle' || row.targetType === 'student') return row.targetType;
  return 'class';
}

function mapHomework(row: typeof homeworkAssignments.$inferSelect): HomeworkAssignmentView {
  return {
    id: row.id,
    cycleId: row.cycleId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    description: row.description,
    wordIds: cleanIds(parseJson(row.wordIds, [])),
    taskTypes: cleanScenarioIds(parseJson(row.taskTypes, [])),
    dueDate: row.dueDate,
    className: row.className,
    targetType: targetTypeFor(row),
    studentIds: cleanIds(parseJson(row.studentIdsJson, [])),
    klpIds: cleanIds(parseJson(row.klpIdsJson, [])),
    scenarioIds: cleanScenarioIds(parseJson(row.scenarioIdsJson, [])),
    source: row.source === 'klp' ? 'klp' : 'manual',
    status: row.status || 'assigned',
    pathConfig: parsePathConfig(row.pathConfigJson),
    createdAt: row.createdAt,
  };
}

function parsePathConfig(value: string | null | undefined): HomeworkPathConfig | null {
  const parsed = parseJson<Record<string, unknown> | null>(value, null);
  if (!parsed || Number(parsed.version) !== 1) return null;
  return {
    version: 1,
    targetWordIds: cleanIds(parsed.targetWordIds),
    controlledScenarioId: typeof parsed.controlledScenarioId === 'string' && parsed.controlledScenarioId.trim() ? parsed.controlledScenarioId.trim() : null,
    openScenarioId: typeof parsed.openScenarioId === 'string' && parsed.openScenarioId.trim() ? parsed.openScenarioId.trim() : null,
    textPracticeId: Number.isInteger(Number(parsed.textPracticeId)) ? Number(parsed.textPracticeId) : null,
  };
}

export async function createHomework(data: {
  cycleId: number;
  createdByUserId: number;
  title: string;
  description?: string;
  wordIds: number[];
  taskTypes: string[];
  dueDate: string;
  className?: string;
  targetType?: HomeworkTargetType;
  studentIds?: number[];
  klpIds?: number[];
  scenarioIds?: string[];
  source?: HomeworkSource;
  status?: string;
  pathConfig?: HomeworkPathConfig | null;
}) {
  const targetType = data.targetType ?? (data.studentIds?.length ? 'student' : data.className ? 'class' : 'cycle');
  return ((await db
    .insert(homeworkAssignments)
    .values({
      cycleId: data.cycleId,
      createdByUserId: data.createdByUserId,
      title: data.title,
      description: data.description ?? null,
      wordIds: JSON.stringify(data.wordIds),
      taskTypes: JSON.stringify(data.taskTypes),
      dueDate: data.dueDate,
      className: data.className ?? null,
      targetType,
      studentIdsJson: JSON.stringify(cleanIds(data.studentIds ?? [])),
      klpIdsJson: JSON.stringify(cleanIds(data.klpIds ?? [])),
      scenarioIdsJson: JSON.stringify(cleanScenarioIds(data.scenarioIds ?? [])),
      source: data.source ?? 'manual',
      status: data.status ?? 'assigned',
      pathConfigJson: data.pathConfig ? JSON.stringify(data.pathConfig) : null,
      createdAt: new Date().toISOString(),
    })
    .returning())[0]);
}

export async function getHomeworkForStudent(studentId: number, className: string) {
  const student = ((await db.select().from(students).where(eq(students.id, studentId)).limit(1))[0]);
  const effectiveClass = className || student?.class || '';
  const cycleIds = new Set(
    (await db
      .select()
      .from(studentCycles)
      .where(eq(studentCycles.studentId, studentId)))
      .map((enrollment) => enrollment.cycleId),
  );

  const allHomework = (await db
    .select()
    .from(homeworkAssignments)
    .orderBy(desc(homeworkAssignments.dueDate)))
    .map(mapHomework)
    .filter((hw) => hw.status !== 'archived')
    .filter((hw) => {
      if (hw.targetType === 'student') return hw.studentIds.includes(studentId);
      if (hw.targetType === 'cycle') return cycleIds.has(hw.cycleId);
      return !!effectiveClass && hw.className === effectiveClass;
    });

  // Get student's submissions
  const submissions = (await db
    .select()
    .from(homeworkSubmissions)
    .where(eq(homeworkSubmissions.studentId, studentId)));

  const submittedIds = new Set(submissions.map((s) => s.homeworkId));

  return allHomework.map((hw) => ({
    ...hw,
    submitted: submittedIds.has(hw.id),
    submission: submissions.find((s) => s.homeworkId === hw.id) ?? null,
  }));
}

export async function getHomeworkForTeacher(cycleId: number) {
  const homework = (await db
    .select()
    .from(homeworkAssignments)
    .where(eq(homeworkAssignments.cycleId, cycleId))
    .orderBy(desc(homeworkAssignments.dueDate)))
    .map(mapHomework);

  return Promise.all(homework.map(async (hw) => {
    const submissions = (await db
      .select()
      .from(homeworkSubmissions)
      .where(eq(homeworkSubmissions.homeworkId, hw.id)));

    const completedCount = submissions.filter((s) => s.completedAt !== null).length;
    const avgScore =
      submissions.length > 0
        ? submissions.reduce((sum, s) => sum + s.avgScore, 0) / submissions.length
        : 0;

    return {
      ...hw,
      submissionCount: submissions.length,
      completedCount,
      avgScore,
    };
  }));
}

export async function getKlpAssignmentsForStudent(studentId: number) {
  const student = ((await db.select().from(students).where(eq(students.id, studentId)).limit(1))[0]);
  const assignments = (await getHomeworkForStudent(studentId, student?.class ?? ''))
    .filter((hw) => hw.source === 'klp' && (hw.klpIds.length > 0 || hw.scenarioIds.length > 0));

  const klpIds = Array.from(new Set(assignments.flatMap((assignment) => assignment.klpIds)));
  const scenarioIds = Array.from(new Set(assignments.flatMap((assignment) => assignment.scenarioIds)));
  const klpRows = klpIds.length
    ? await db.select({
        id: klpConcepts.id,
        conceptId: klpConcepts.conceptId,
        book: klpConcepts.book,
        lesson: klpConcepts.lesson,
        domain: klpConcepts.domain,
        baseItem: klpConcepts.baseItem,
        subtype: klpConcepts.subtype,
        supportStatus: klpConcepts.supportStatus,
      }).from(klpConcepts).where(inArray(klpConcepts.id, klpIds))
    : [];
  const scenarioRows = scenarioIds.length
    ? await db.select({
        scenarioId: klpGeneratedScenarios.scenarioId,
        title: klpGeneratedScenarios.title,
        description: klpGeneratedScenarios.description,
        cefrLevel: klpGeneratedScenarios.cefrLevel,
        status: klpGeneratedScenarios.status,
      }).from(klpGeneratedScenarios).where(inArray(klpGeneratedScenarios.scenarioId, scenarioIds))
    : [];
  const klpById = new Map(klpRows.map((row) => [Number(row.id), row]));
  const scenarioById = new Map(scenarioRows.map((row) => [row.scenarioId, row]));

  return assignments.map((assignment) => ({
    ...assignment,
    klps: assignment.klpIds.map((id) => klpById.get(id)).filter(Boolean),
    scenarios: assignment.scenarioIds.map((id) => scenarioById.get(id)).filter(Boolean),
  }));
}

export async function getAssignedKlpScenarioIdsForStudent(studentId: number) {
  return Array.from(new Set(
    (await getKlpAssignmentsForStudent(studentId))
      .flatMap((assignment) => assignment.scenarioIds),
  ));
}

export async function submitHomework(
  homeworkId: number,
  studentId: number,
  wordsCompleted: number,
  avgScore: number
) {
  // Check for existing submission
  const existing = ((await db
    .select()
    .from(homeworkSubmissions)
    .where(
      and(
        eq(homeworkSubmissions.homeworkId, homeworkId),
        eq(homeworkSubmissions.studentId, studentId)
      )
    ).limit(1))[0]);

  if (existing) {
    // Update existing submission
    (await db.update(homeworkSubmissions)
      .set({
        completedAt: new Date().toISOString(),
        wordsCompleted,
        avgScore,
      })
      .where(eq(homeworkSubmissions.id, existing.id)));
    return { ...existing, completedAt: new Date().toISOString(), wordsCompleted, avgScore };
  }

  return ((await db
    .insert(homeworkSubmissions)
    .values({
      homeworkId,
      studentId,
      completedAt: new Date().toISOString(),
      wordsCompleted,
      avgScore,
    })
    .returning())[0]);
}
