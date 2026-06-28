import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, sqlite } from '@/lib/db';
import {
  appSettings,
  attemptKlpResults,
  attempts,
  klpActiveQuestionShapes,
  klpConcepts,
  klpGeneratedScenarios,
  klpImportSources,
  practiceTaskKlps,
  practiceTasks,
  scenarioAttempts,
  scenarioKlps,
  studentKlpSummaries,
  students,
  vocabularyItems,
} from '@/lib/db/schema';
import { callChat } from '@/lib/ai/providers';
import { getKlpAssignmentsForStudent } from '@/lib/actions/homework-actions';
import { parseAlcKlpWorkbook, type KlpSupportStatus, type ParsedKlpWorkbook } from '@/lib/klp/xlsx';
import type { Scenario } from '@/lib/ai/scenarios';

export const KLP_FEATURE_FLAG = 'klp_features_enabled';

type Row = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeTerm(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function vocabularyTerms(row: { subtype?: string | null; baseItem?: string | null; definition?: string | null }) {
  const parts = [row.subtype, row.baseItem, row.definition].filter((value): value is string => !!value);
  const terms = new Set<string>();
  for (const part of parts) {
    for (const piece of part.split(/[;/,]|\bor\b/gi)) {
      const cleaned = piece.replace(/^\s*\d+\s*[-–:]\s*/, '').trim();
      const normalized = normalizeTerm(cleaned);
      if (normalized) terms.add(normalized);
    }
  }
  return terms;
}

export function isKlpEnabled() {
  const setting = db.select().from(appSettings).where(eq(appSettings.key, KLP_FEATURE_FLAG)).get();
  return setting?.value === 'true';
}

export function setKlpEnabled(enabled: boolean) {
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KLP_FEATURE_FLAG)).get();
  if (existing) db.update(appSettings).set({ value: enabled ? 'true' : 'false' }).where(eq(appSettings.key, KLP_FEATURE_FLAG)).run();
  else db.insert(appSettings).values({ key: KLP_FEATURE_FLAG, value: enabled ? 'true' : 'false' }).run();
}

export function validateKlpWorkbook(buffer: Buffer) {
  return parseAlcKlpWorkbook(buffer);
}

export function importKlpWorkbook(data: {
  buffer: Buffer;
  fileName?: string;
  name?: string;
  importedByUserId?: number;
}) {
  const parsed = parseAlcKlpWorkbook(data.buffer);
  const importedAt = nowIso();
  const source = db
    .insert(klpImportSources)
    .values({
      name: data.name?.trim() || 'ALC Index',
      fileName: data.fileName ?? null,
      importedAt,
      importedByUserId: data.importedByUserId ?? null,
      totalConcepts: parsed.concepts.length,
      activeQuestionShapes: parsed.activeQuestionShapes.length,
      warningsJson: JSON.stringify(parsed.warnings),
      status: 'imported',
    })
    .returning()
    .get();

  const conceptRows = parsed.concepts.map((concept) => ({
    sourceId: source.id,
    conceptId: concept.conceptId,
    book: concept.book || null,
    lesson: concept.lesson || null,
    domain: concept.domain,
    conceptNumber: concept.conceptNumber || null,
    subdivision: concept.subdivision || null,
    baseItem: concept.baseItem || null,
    subtype: concept.subtype || null,
    partOfSpeech: concept.partOfSpeech || null,
    definition: concept.definition || null,
    dliClassification: concept.dliClassification || null,
    primarySkillType: concept.primarySkillType || null,
    secondarySkillType: concept.secondarySkillType || null,
    tertiarySkillType: concept.tertiarySkillType || null,
    quaternarySkillType: concept.quaternarySkillType || null,
    duplicateInCourse: concept.duplicateInCourse || null,
    duplicateInBook: concept.duplicateInBook || null,
    supportStatus: concept.supportStatus,
    activeQuestionCount: concept.activeQuestionCount,
    activeQuestionShapesJson: JSON.stringify(concept.activeQuestionShapes),
    rawJson: JSON.stringify(concept.raw),
    createdAt: importedAt,
  }));

  for (const part of chunk(conceptRows, 250)) db.insert(klpConcepts).values(part).run();

  const questionRows = parsed.activeQuestionShapes.map((question) => ({
    sourceId: source.id,
    questionId: question.questionId,
    conceptId: question.conceptId,
    questionShape: question.questionShape,
    modality: question.modality || null,
    rawJson: JSON.stringify(question.raw),
  }));
  for (const part of chunk(questionRows, 300)) db.insert(klpActiveQuestionShapes).values(part).run();

  const linkedTaskCount = autoLinkVocabularyTasksToKlp(source.id);
  setKlpEnabled(true);

  return {
    source,
    parsed: parsed.summary,
    warnings: parsed.warnings,
    linkedTaskCount,
  };
}

export function autoLinkVocabularyTasksToKlp(sourceId?: number) {
  const latestSource = sourceId
    ? db.select().from(klpImportSources).where(eq(klpImportSources.id, sourceId)).get()
    : getLatestKlpSource();
  if (!latestSource) return 0;

  const concepts = db
    .select({
      id: klpConcepts.id,
      subtype: klpConcepts.subtype,
      baseItem: klpConcepts.baseItem,
      definition: klpConcepts.definition,
    })
    .from(klpConcepts)
    .where(and(
      eq(klpConcepts.sourceId, latestSource.id),
      eq(klpConcepts.domain, 'Vocabulary'),
      eq(klpConcepts.supportStatus, 'speaking_scored'),
    ))
    .all();

  const termToConcept = new Map<string, number>();
  for (const concept of concepts) {
    for (const term of vocabularyTerms(concept)) {
      if (!termToConcept.has(term)) termToConcept.set(term, concept.id);
    }
  }

  const tasks = db
    .select({
      taskId: practiceTasks.id,
      word: vocabularyItems.word,
    })
    .from(practiceTasks)
    .innerJoin(vocabularyItems, eq(vocabularyItems.id, practiceTasks.vocabularyItemId))
    .all();

  let linked = 0;
  for (const task of tasks) {
    const conceptId = termToConcept.get(normalizeTerm(task.word));
    if (!conceptId) continue;
    const existing = db
      .select()
      .from(practiceTaskKlps)
      .where(and(eq(practiceTaskKlps.practiceTaskId, task.taskId), eq(practiceTaskKlps.klpConceptId, conceptId)))
      .get();
    if (existing) continue;
    db.insert(practiceTaskKlps)
      .values({
        practiceTaskId: task.taskId,
        klpConceptId: conceptId,
        assessmentMode: 'speaking_performance',
        createdAt: nowIso(),
      })
      .run();
    linked += 1;
  }
  return linked;
}

export function getLatestKlpSource() {
  return db.select().from(klpImportSources).orderBy(klpImportSources.id).all().at(-1) ?? null;
}

export function getKlpOverview() {
  const latest = getLatestKlpSource();
  const enabled = isKlpEnabled();
  const conceptCounts = sqlite.prepare(`
    SELECT domain, support_status AS supportStatus, COUNT(*) AS count
    FROM klp_concepts
    ${latest ? 'WHERE source_id = ?' : ''}
    GROUP BY domain, support_status
  `).all(...(latest ? [latest.id] : [])) as Array<{ domain: string; supportStatus: string; count: number }>;
  const totals = sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM klp_concepts ${latest ? 'WHERE source_id = ?' : ''}) AS totalConcepts,
      (SELECT COUNT(*) FROM klp_active_question_shapes ${latest ? 'WHERE source_id = ?' : ''}) AS activeQuestionShapes,
      (SELECT COUNT(DISTINCT klp_concept_id) FROM attempt_klp_results) AS practicedConcepts,
      (SELECT COUNT(*) FROM attempt_klp_results) AS resultEvents,
      (SELECT COUNT(*) FROM klp_generated_scenarios) AS generatedScenarios,
      (SELECT COUNT(*) FROM klp_generated_scenarios WHERE status = 'published') AS publishedScenarios,
      (SELECT COUNT(*) FROM practice_task_klps) AS linkedPracticeTasks,
      (SELECT COUNT(*) FROM homework_assignments WHERE source = 'klp' AND status != 'archived') AS assignedStudyPlans,
      (SELECT COUNT(*) FROM homework_assignments WHERE source = 'klp' AND scenario_ids_json != '[]' AND status != 'archived') AS assignedScenarioPlans
  `).get(...(latest ? [latest.id, latest.id] : [])) as Row;
  const warnings = parseJson<string[]>(latest?.warningsJson, []);
  const byDomain: Record<string, number> = {};
  const bySupportStatus: Record<string, number> = {};
  for (const row of conceptCounts) {
    byDomain[row.domain] = (byDomain[row.domain] ?? 0) + Number(row.count);
    bySupportStatus[row.supportStatus] = (bySupportStatus[row.supportStatus] ?? 0) + Number(row.count);
  }
  return {
    enabled,
    latestSource: latest,
    warnings,
    totals,
    byDomain,
    bySupportStatus,
  };
}

export function listKlpConcepts(filters: {
  sourceId?: number | null;
  q?: string | null;
  book?: string | null;
  lesson?: string | null;
  domain?: string | null;
  supportStatus?: string | null;
  limit?: number;
  offset?: number;
} = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const latest = filters.sourceId ? null : getLatestKlpSource();
  if (filters.sourceId || latest) {
    where.push('source_id = ?');
    params.push(filters.sourceId ?? latest?.id);
  }
  if (filters.q) {
    where.push('(concept_id LIKE ? OR base_item LIKE ? OR subtype LIKE ? OR definition LIKE ?)');
    const value = `%${filters.q}%`;
    params.push(value, value, value, value);
  }
  if (filters.book) { where.push('book = ?'); params.push(filters.book); }
  if (filters.lesson) { where.push('lesson = ?'); params.push(filters.lesson); }
  if (filters.domain) { where.push('domain = ?'); params.push(filters.domain); }
  if (filters.supportStatus) { where.push('support_status = ?'); params.push(filters.supportStatus); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);
  const rows = sqlite.prepare(`
    SELECT * FROM klp_concepts
    ${whereSql}
    ORDER BY CAST(book AS INTEGER), CAST(lesson AS INTEGER), domain, concept_number, subdivision
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Row[];
  const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM klp_concepts ${whereSql}`).get(...params) as { count: number };
  return { rows: rows.map(normalizeConceptRow), count: count.count, limit, offset };
}

function normalizeConceptRow(row: Row) {
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    conceptId: String(row.concept_id),
    book: row.book ? String(row.book) : null,
    lesson: row.lesson ? String(row.lesson) : null,
    domain: String(row.domain),
    conceptNumber: row.concept_number ? String(row.concept_number) : null,
    subdivision: row.subdivision ? String(row.subdivision) : null,
    baseItem: row.base_item ? String(row.base_item) : null,
    subtype: row.subtype ? String(row.subtype) : null,
    partOfSpeech: row.part_of_speech ? String(row.part_of_speech) : null,
    definition: row.definition ? String(row.definition) : null,
    dliClassification: row.dli_classification ? String(row.dli_classification) : null,
    primarySkillType: row.primary_skill_type ? String(row.primary_skill_type) : null,
    secondarySkillType: row.secondary_skill_type ? String(row.secondary_skill_type) : null,
    supportStatus: String(row.support_status) as KlpSupportStatus,
    activeQuestionCount: Number(row.active_question_count ?? 0),
    activeQuestionShapes: parseJson<string[]>(row.active_question_shapes_json as string, []),
  };
}

function getConceptsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  return db.select().from(klpConcepts).where(inArray(klpConcepts.id, ids)).all();
}

function normalizeProgressionMode(value: unknown): Scenario['progressionMode'] {
  return value === 'controlled' || value === 'open' || value === 'simulation' ? value : 'guided';
}

function scenarioPromptFromConcepts(concepts: ReturnType<typeof getConceptsByIds>, cefrLevel: string, progressionMode: Scenario['progressionMode']) {
  const compact = concepts.map((concept) => ({
    id: concept.id,
    conceptId: concept.conceptId,
    domain: concept.domain,
    supportStatus: concept.supportStatus,
    item: concept.subtype || concept.baseItem || concept.definition,
    book: concept.book,
    lesson: concept.lesson,
  }));
  return [
    'Generate one short English role-play scenario for Arabic-speaking learners.',
    'The scenario is for speaking fluency and spoken accuracy practice, not grammar mastery.',
    'Use Grammar/Function KLPs only as context. Do not claim grammar mastery.',
    `Target CEFR: ${cefrLevel}.`,
    `Progression mode: ${progressionMode}. Controlled means tightly target the selected language; guided means real-life role-play; open means less scripted conversation; simulation means exam/workplace performance practice.`,
    'Return strict JSON only with this shape:',
    '{"title":"","description":"","aiRole":"","studentGoal":"","firstMessage":"","successCriteria":[""],"targetVocabulary":[""],"minTurns":4}',
    `KLP_CONTEXT=${JSON.stringify(compact)}`,
  ].join('\n');
}

function fallbackScenario(concepts: ReturnType<typeof getConceptsByIds>, cefrLevel: string) {
  const first = concepts[0];
  const label = first?.subtype || first?.baseItem || first?.definition || 'lesson language';
  const targetVocabulary = concepts
    .filter((concept) => concept.domain === 'Vocabulary')
    .map((concept) => concept.subtype || concept.baseItem || concept.definition || '')
    .filter(Boolean)
    .slice(0, 6);
  return {
    title: `Practice ${label}`,
    description: `Use the selected lesson language in a short real-life conversation.`,
    aiRole: 'a helpful classmate',
    studentGoal: `Respond naturally and use ${label} where it fits.`,
    firstMessage: `Hi! Let's practice ${label}. Can you start with one clear sentence?`,
    successCriteria: [
      'Responded with meaningful English',
      'Used the target lesson language where appropriate',
      'Kept the conversation going with a clear answer',
      'Spoke politely and naturally',
    ],
    targetVocabulary,
    minTurns: 4,
    aiAvailable: false,
  };
}

function parseScenarioJson(text: string, concepts: ReturnType<typeof getConceptsByIds>, cefrLevel: string) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    const fallback = fallbackScenario(concepts, cefrLevel);
    return {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallback.title,
      description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : fallback.description,
      aiRole: typeof parsed.aiRole === 'string' && parsed.aiRole.trim() ? parsed.aiRole.trim() : fallback.aiRole,
      studentGoal: typeof parsed.studentGoal === 'string' && parsed.studentGoal.trim() ? parsed.studentGoal.trim() : fallback.studentGoal,
      firstMessage: typeof parsed.firstMessage === 'string' && parsed.firstMessage.trim() ? parsed.firstMessage.trim() : fallback.firstMessage,
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6) : fallback.successCriteria,
      targetVocabulary: Array.isArray(parsed.targetVocabulary) ? parsed.targetVocabulary.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10) : fallback.targetVocabulary,
      minTurns: Number.isInteger(parsed.minTurns) ? Math.max(3, Math.min(8, parsed.minTurns)) : fallback.minTurns,
      aiAvailable: true,
    };
  } catch {
    return fallbackScenario(concepts, cefrLevel);
  }
}

export async function generateKlpScenario(data: {
  klpIds: number[];
  cefrLevel: string;
  progressionMode?: Scenario['progressionMode'];
  createdByUserId?: number;
}) {
  const concepts = getConceptsByIds(data.klpIds);
  if (concepts.length === 0) throw new Error('Select at least one valid KLP.');
  const progressionMode = normalizeProgressionMode(data.progressionMode);
  let draft: ReturnType<typeof fallbackScenario>;
  try {
    const result = await callChat([
      { role: 'system', content: 'You create concise English-speaking role-play scenarios for a language lab. Return only strict JSON.' },
      { role: 'user', content: scenarioPromptFromConcepts(concepts, data.cefrLevel, progressionMode) },
    ], { temperature: 0.35, maxTokens: 600 });
    draft = parseScenarioJson(result.content, concepts, data.cefrLevel);
  } catch {
    draft = fallbackScenario(concepts, data.cefrLevel);
  }

  const createdAt = nowIso();
  const scenarioId = `klp-${nanoid(10)}`;
  const tutorRules = 'Stay in character. Keep each reply to 1-2 short sentences. Ask one question at a time. Stay focused on the student goal and target lesson language. If the student asks for unrelated, unsafe, or adult content, briefly redirect them back to the lesson. Never write Arabic. This is speaking-performance practice, not grammar mastery scoring.';
  const systemPrompt = `You are ${draft.aiRole}. The student goal is: ${draft.studentGoal}. ${tutorRules}`;
  const row = db.insert(klpGeneratedScenarios).values({
    scenarioId,
    title: draft.title,
    description: draft.description,
    cefrLevel: data.cefrLevel || 'A1',
    icon: 'Drama',
    aiRole: draft.aiRole,
    studentGoal: draft.studentGoal,
    systemPrompt,
    firstMessage: draft.firstMessage,
    successCriteriaJson: JSON.stringify(draft.successCriteria),
    targetVocabularyJson: JSON.stringify(draft.targetVocabulary),
    minTurns: draft.minTurns,
    progressionMode,
    status: 'draft',
    source: draft.aiAvailable ? 'ai_klp' : 'fallback_klp',
    createdByUserId: data.createdByUserId ?? null,
    createdAt,
    updatedAt: createdAt,
    klpIdsJson: JSON.stringify(concepts.map((concept) => concept.id)),
  }).returning().get();

  for (const concept of concepts) {
    db.insert(scenarioKlps).values({
      scenarioId,
      klpConceptId: concept.id,
      assessmentMode: concept.supportStatus === 'prompt_context_only' ? 'context_only' : 'speaking_performance',
      createdAt,
    }).run();
  }
  return row;
}

export function listGeneratedScenarios(includeDrafts = false) {
  const rows = includeDrafts
    ? db.select().from(klpGeneratedScenarios).all()
    : db.select().from(klpGeneratedScenarios).where(eq(klpGeneratedScenarios.status, 'published')).all();
  return rows.sort((a, b) => b.id - a.id).map((row) => ({
    ...row,
    successCriteria: parseJson<string[]>(row.successCriteriaJson, []),
    targetVocabulary: parseJson<string[]>(row.targetVocabularyJson, []),
    klpIds: parseJson<number[]>(row.klpIdsJson, []),
  }));
}

export function publishGeneratedScenario(id: number, publish: boolean) {
  const updatedAt = nowIso();
  const row = db.update(klpGeneratedScenarios).set({
    status: publish ? 'published' : 'draft',
    updatedAt,
    publishedAt: publish ? updatedAt : null,
  }).where(eq(klpGeneratedScenarios.id, id)).returning().get();
  return row;
}

export function generatedScenarioAsScenario(row: ReturnType<typeof listGeneratedScenarios>[number]): Scenario {
  return {
    id: row.scenarioId,
    title: row.title,
    icon: row.icon || 'Drama',
    cefrBands: [row.cefrLevel as Scenario['cefrBands'][number]],
    description: row.description,
    systemPrompt: row.systemPrompt,
    firstMessage: row.firstMessage,
    successCriteria: row.successCriteria.length ? row.successCriteria : ['Responded with meaningful English'],
    minTurns: row.minTurns || 4,
    studentGoal: row.studentGoal,
    targetVocabulary: row.targetVocabulary,
    progressionMode: normalizeProgressionMode(row.progressionMode) || (/^practice\s+/i.test(row.title) ? 'controlled' : 'guided'),
    estimatedMinutes: Math.max(3, row.minTurns || 4),
  };
}

export function getGeneratedScenario(scenarioId: string): Scenario | null {
  const row = db.select().from(klpGeneratedScenarios).where(eq(klpGeneratedScenarios.scenarioId, scenarioId)).get();
  if (!row || row.status !== 'published') return null;
  return generatedScenarioAsScenario({
    ...row,
    successCriteria: parseJson<string[]>(row.successCriteriaJson, []),
    targetVocabulary: parseJson<string[]>(row.targetVocabularyJson, []),
    klpIds: parseJson<number[]>(row.klpIdsJson, []),
  });
}

export function recordAttemptKlpResults(data: {
  attemptId: number;
  studentId: number;
  practiceTaskId: number;
  scores: {
    targetMatch: number;
    pronunciation: number;
    fluency: number;
    completeness: number;
    consistency: number;
    composite: number;
  };
  passScore?: number;
}) {
  const links = db
    .select({
      klpConceptId: practiceTaskKlps.klpConceptId,
      assessmentMode: practiceTaskKlps.assessmentMode,
      supportStatus: klpConcepts.supportStatus,
    })
    .from(practiceTaskKlps)
    .innerJoin(klpConcepts, eq(klpConcepts.id, practiceTaskKlps.klpConceptId))
    .where(eq(practiceTaskKlps.practiceTaskId, data.practiceTaskId))
    .all();
  const createdAt = nowIso();
  const out = [];
  for (const link of links) {
    const assessed = link.supportStatus === 'speaking_scored' && link.assessmentMode !== 'context_only';
    const passed = assessed && data.scores.composite >= (data.passScore ?? 0.75);
    const result = db.insert(attemptKlpResults).values({
      attemptId: data.attemptId,
      scenarioAttemptId: null,
      studentId: data.studentId,
      klpConceptId: link.klpConceptId,
      assessmentMode: assessed ? 'speaking_performance' : 'context_only',
      supportStatus: link.supportStatus,
      assessed,
      successScorePercent: passed ? 100 : 0,
      passed,
      confidence: assessed ? 1 : 0,
      rawScoresJson: JSON.stringify(data.scores),
      createdAt,
    }).returning().get();
    upsertStudentKlpSummary(data.studentId, link.klpConceptId, passed ? 100 : 0, passed, createdAt);
    out.push(result);
  }
  return out;
}

export function recordScenarioKlpResults(data: {
  scenarioAttemptId: number;
  scenarioId: string;
  studentId: number;
  score: number;
  criteriaMet: boolean[];
}) {
  const links = db
    .select({
      klpConceptId: scenarioKlps.klpConceptId,
      assessmentMode: scenarioKlps.assessmentMode,
      supportStatus: klpConcepts.supportStatus,
    })
    .from(scenarioKlps)
    .innerJoin(klpConcepts, eq(klpConcepts.id, scenarioKlps.klpConceptId))
    .where(eq(scenarioKlps.scenarioId, data.scenarioId))
    .all();
  const createdAt = nowIso();
  const out = [];
  for (const link of links) {
    const assessed = link.supportStatus === 'speaking_scored' && link.assessmentMode !== 'context_only';
    const passed = assessed && data.score >= 75;
    const result = db.insert(attemptKlpResults).values({
      attemptId: null,
      scenarioAttemptId: data.scenarioAttemptId,
      studentId: data.studentId,
      klpConceptId: link.klpConceptId,
      assessmentMode: assessed ? 'speaking_performance' : 'context_only',
      supportStatus: link.supportStatus,
      assessed,
      successScorePercent: passed ? 100 : 0,
      passed,
      confidence: assessed ? 0.85 : 0,
      rawScoresJson: JSON.stringify({ scenarioScore: data.score, criteriaMet: data.criteriaMet }),
      createdAt,
    }).returning().get();
    upsertStudentKlpSummary(data.studentId, link.klpConceptId, passed ? 100 : 0, passed, createdAt);
    out.push(result);
  }
  return out;
}

function upsertStudentKlpSummary(studentId: number, klpConceptId: number, scorePercent: number, passed: boolean, timestamp: string) {
  const existing = db
    .select()
    .from(studentKlpSummaries)
    .where(and(eq(studentKlpSummaries.studentId, studentId), eq(studentKlpSummaries.klpConceptId, klpConceptId)))
    .get();
  if (existing) {
    db.update(studentKlpSummaries).set({
      attempts: existing.attempts + 1,
      successes: existing.successes + (passed ? 1 : 0),
      latestScorePercent: scorePercent,
      lastPracticedAt: timestamp,
    }).where(eq(studentKlpSummaries.id, existing.id)).run();
  } else {
    db.insert(studentKlpSummaries).values({
      studentId,
      klpConceptId,
      attempts: 1,
      successes: passed ? 1 : 0,
      latestScorePercent: scorePercent,
      lastPracticedAt: timestamp,
    }).run();
  }
}

export function getKlpResults(filters: { studentId?: number; limit?: number } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.studentId) {
    where.push('akr.student_id = ?');
    params.push(filters.studentId);
  }
  const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
  const rows = sqlite.prepare(`
    SELECT
      akr.id AS eventId,
      akr.created_at AS timestamp,
      akr.attempt_id AS attemptId,
      akr.scenario_attempt_id AS scenarioAttemptId,
      sa.scenario_id AS scenarioId,
      akr.student_id AS studentId,
      s.unique_number AS studentNumber,
      s.full_name AS studentName,
      kc.id AS klpId,
      kc.concept_id AS conceptId,
      kc.book,
      kc.lesson,
      kc.domain,
      kc.base_item AS baseItem,
      kc.subtype,
      kc.support_status AS supportStatus,
      akr.assessment_mode AS assessmentMode,
      akr.assessed,
      akr.success_score_percent AS successScorePercent,
      akr.passed,
      akr.confidence,
      akr.raw_scores_json AS rawScoresJson
    FROM attempt_klp_results akr
    INNER JOIN students s ON s.id = akr.student_id
    INNER JOIN klp_concepts kc ON kc.id = akr.klp_concept_id
    LEFT JOIN scenario_attempts sa ON sa.id = akr.scenario_attempt_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY akr.created_at DESC
    LIMIT ?
  `).all(...params, limit) as Row[];
  return rows.map((row) => ({
    eventId: Number(row.eventId),
    timestamp: String(row.timestamp),
    attemptId: row.attemptId === null ? null : Number(row.attemptId),
    scenarioAttemptId: row.scenarioAttemptId === null ? null : Number(row.scenarioAttemptId),
    scenarioId: row.scenarioId ? String(row.scenarioId) : null,
    student: {
      id: Number(row.studentId),
      uniqueNumber: String(row.studentNumber),
      fullName: String(row.studentName),
    },
    klp: {
      id: Number(row.klpId),
      conceptId: String(row.conceptId),
      book: row.book ? String(row.book) : null,
      lesson: row.lesson ? String(row.lesson) : null,
      domain: String(row.domain),
      baseItem: row.baseItem ? String(row.baseItem) : null,
      subtype: row.subtype ? String(row.subtype) : null,
      supportStatus: String(row.supportStatus),
    },
    assessmentMode: String(row.assessmentMode),
    assessed: Boolean(row.assessed),
    successScorePercent: Number(row.successScorePercent),
    passed: Boolean(row.passed),
    confidence: Number(row.confidence),
    scores: parseJson(row.rawScoresJson as string, {}),
    assignments: getKlpAssignmentsForStudent(Number(row.studentId))
      .filter((assignment) =>
        assignment.klpIds.includes(Number(row.klpId)) ||
        (!!row.scenarioId && assignment.scenarioIds.includes(String(row.scenarioId))),
      )
      .map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        targetType: assignment.targetType,
        cycleId: assignment.cycleId,
        className: assignment.className,
        studentIds: assignment.studentIds,
        dueDate: assignment.dueDate,
        taskTypes: assignment.taskTypes,
        scenarioIds: assignment.scenarioIds,
      })),
  }));
}

export function getKlpCatalogExport() {
  const rows = sqlite.prepare(`
    SELECT * FROM klp_concepts
    ORDER BY CAST(book AS INTEGER), CAST(lesson AS INTEGER), domain, concept_number, subdivision
  `).all() as Row[];
  return rows.map(normalizeConceptRow);
}
