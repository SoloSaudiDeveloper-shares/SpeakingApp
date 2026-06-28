import { desc, eq } from 'drizzle-orm';
import { db, sqlite } from '@/lib/db';
import {
  attemptKlpResults,
  attempts,
  homeworkAssignments,
  klpConcepts,
  klpGeneratedScenarios,
  practiceTasks,
  practiceTaskKlps,
  scenarioKlps,
  students,
  studentCycles,
  vocabularyItems,
  wordMasteryRecords,
} from '@/lib/db/schema';
import { getKlpAssignmentsForStudent } from '@/lib/actions/homework-actions';

export interface ReportFilters {
  className?: string | null;
  cefr?: string | null;
  from?: string | null;
  to?: string | null;
  studentId?: number | null;
}

export interface ReportKpis {
  totalStudents: number;
  activeStudents: number;
  diagnosticCompletionRate: number;
  totalAttempts: number;
  attemptsInRange: number;
  averageScore: number;
  passRate: number;
  averagePronunciation: number;
  averageFluency: number;
  averageContent: number;
  weakWordCount: number;
  audioAttemptCount: number;
  studentsNeedingAttention: number;
}

export interface StudentReportSummary {
  id: number;
  fullName: string;
  uniqueNumber: string;
  className: string | null;
  cefrBand: string;
  hasDiagnostic: boolean;
  diagnosticProfile: Record<string, unknown> | null;
  attempts: number;
  attemptsInRange: number;
  averageScore: number;
  averagePronunciation: number;
  averageFluency: number;
  averageContent: number;
  passRate: number;
  masteredWords: number;
  developingWords: number;
  weakWordCount: number;
  lastAttemptAt: string | null;
  needsAttention: boolean;
  attentionReasons: string[];
}

export interface ClassReportSummary {
  className: string;
  studentCount: number;
  diagnosticCompletionRate: number;
  attempts: number;
  averageScore: number;
  passRate: number;
  averagePronunciation: number;
  averageFluency: number;
  weakWordCount: number;
  studentsNeedingAttention: number;
}

export interface WeakWordSummary {
  word: string;
  count: number;
  sources: string[];
  students: Array<{ id: number; name: string }>;
  averageScore: number | null;
}

export interface AudioAttemptSummary {
  id: number;
  studentId: number;
  studentName: string;
  className: string | null;
  timestamp: string;
  audioPath: string;
  transcript: string | null;
  score: number;
  taskType: string | null;
  word: string | null;
}

export interface ReportOverview {
  generatedAt: string;
  filters: ReportFilters;
  kpis: ReportKpis;
  classes: string[];
  cefrBands: string[];
  students: StudentReportSummary[];
  classSummaries: ClassReportSummary[];
  topWeakWords: WeakWordSummary[];
  audioAttempts: AudioAttemptSummary[];
  recentAttempts: AudioAttemptSummary[];
  deterministicInsights: string[];
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '').trim();
}

function inDateRange(timestamp: string, filters: ReportFilters) {
  const date = new Date(timestamp).getTime();
  if (!Number.isFinite(date)) return true;
  if (filters.from && date < new Date(filters.from).getTime()) return false;
  if (filters.to) {
    const end = new Date(filters.to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) end.setHours(23, 59, 59, 999);
    if (date > end.getTime()) return false;
  }
  return true;
}

function contentFromMetrics(metricsJson: string | null) {
  const metrics = parseJson<{ freeSpeak?: { contentScore?: number }; contentScore?: number }>(metricsJson, {});
  const value = metrics.freeSpeak?.contentScore ?? metrics.contentScore;
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : null;
}

function pronWeakWords(metricsJson: string | null) {
  const metrics = parseJson<{ pronunciationWeakWords?: Array<{ word?: string; accuracy?: number; errorType?: string }> }>(metricsJson, {});
  return (metrics.pronunciationWeakWords ?? [])
    .map((item) => ({
      word: typeof item.word === 'string' ? item.word.trim() : '',
      accuracy: typeof item.accuracy === 'number' ? item.accuracy / 100 : null,
      errorType: typeof item.errorType === 'string' ? item.errorType : 'Pronunciation',
    }))
    .filter((item) => item.word.length > 0);
}

function statusNeedsPractice(status: string, latestScore: number, bestScore: number) {
  return status !== 'Mastered' || latestScore < 0.75 || bestScore < 0.85;
}

export function getReportOverview(filters: ReportFilters = {}): ReportOverview {
  const allStudents = db.select().from(students).where(eq(students.isActive, true)).all();
  const selectedStudents = allStudents.filter((student) => {
    if (filters.studentId && student.id !== filters.studentId) return false;
    if (filters.className && (student.class ?? 'Unassigned') !== filters.className) return false;
    if (filters.cefr && student.cefrBand !== filters.cefr) return false;
    return true;
  });
  const selectedStudentIds = new Set(selectedStudents.map((student) => student.id));

  const attemptRows = db
    .select({
      id: attempts.id,
      studentId: attempts.studentId,
      timestamp: attempts.timestamp,
      audioPath: attempts.audioPath,
      transcript: attempts.rawTranscript,
      targetMatchScore: attempts.targetMatchScore,
      pronunciationScore: attempts.pronunciationScore,
      fluencyScore: attempts.fluencyScore,
      completenessScore: attempts.completenessScore,
      consistencyScore: attempts.consistencyScore,
      compositeScore: attempts.compositeScore,
      metricsJson: attempts.metricsJson,
      taskType: practiceTasks.taskType,
      word: vocabularyItems.word,
    })
    .from(attempts)
    .leftJoin(practiceTasks, eq(practiceTasks.id, attempts.practiceTaskId))
    .leftJoin(vocabularyItems, eq(vocabularyItems.id, practiceTasks.vocabularyItemId))
    .orderBy(desc(attempts.timestamp))
    .all()
    .filter((attempt) => selectedStudentIds.has(attempt.studentId));

  const filteredAttempts = attemptRows.filter((attempt) => inDateRange(attempt.timestamp, filters));
  const allMastery = db.select().from(wordMasteryRecords).all().filter((record) => selectedStudentIds.has(record.studentId));
  const vocab = db.select().from(vocabularyItems).all();
  const vocabById = new Map(vocab.map((item) => [item.id, item]));
  const studentById = new Map(selectedStudents.map((student) => [student.id, student]));
  const attemptsByStudent = new Map<number, typeof filteredAttempts>();
  const allAttemptsByStudent = new Map<number, typeof attemptRows>();
  const masteryByStudent = new Map<number, typeof allMastery>();

  for (const attempt of filteredAttempts) {
    const current = attemptsByStudent.get(attempt.studentId) ?? [];
    current.push(attempt);
    attemptsByStudent.set(attempt.studentId, current);
  }
  for (const attempt of attemptRows) {
    const current = allAttemptsByStudent.get(attempt.studentId) ?? [];
    current.push(attempt);
    allAttemptsByStudent.set(attempt.studentId, current);
  }
  for (const record of allMastery) {
    const current = masteryByStudent.get(record.studentId) ?? [];
    current.push(record);
    masteryByStudent.set(record.studentId, current);
  }

  const weakMap = new Map<string, WeakWordSummary>();
  function addWeakWord(studentId: number, word: string, source: string, score: number | null) {
    const key = normalizeWord(word);
    if (!key) return;
    const student = studentById.get(studentId);
    if (!student) return;
    const existing = weakMap.get(key) ?? {
      word,
      count: 0,
      sources: [],
      students: [],
      averageScore: null,
    };
    existing.count += 1;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (!existing.students.some((item) => item.id === studentId)) {
      existing.students.push({ id: studentId, name: student.fullName });
    }
    if (score !== null) {
      const previousCount = existing.averageScore === null ? 0 : existing.count - 1;
      const previousTotal = (existing.averageScore ?? 0) * previousCount;
      existing.averageScore = (previousTotal + score) / (previousCount + 1);
    }
    weakMap.set(key, existing);
  }

  for (const record of allMastery) {
    const latestScore = record.latestScore ?? record.bestScore ?? 0;
    if (!statusNeedsPractice(record.masteryStatus, latestScore, record.bestScore ?? 0)) continue;
    const word = vocabById.get(record.vocabularyItemId)?.word;
    if (word) addWeakWord(record.studentId, word, 'Practice', latestScore);
  }
  for (const attempt of filteredAttempts) {
    for (const weak of pronWeakWords(attempt.metricsJson)) {
      addWeakWord(attempt.studentId, weak.word, weak.errorType === 'Omission' ? 'Omission' : 'Pronunciation', weak.accuracy);
    }
  }

  const studentSummaries: StudentReportSummary[] = selectedStudents.map((student) => {
    const attemptsForStudent = attemptsByStudent.get(student.id) ?? [];
    const allAttemptsForStudent = allAttemptsByStudent.get(student.id) ?? [];
    const masteryForStudent = masteryByStudent.get(student.id) ?? [];
    const contentScores = attemptsForStudent.map((attempt) => contentFromMetrics(attempt.metricsJson)).filter((value): value is number => value !== null);
    const averageScore = average(attemptsForStudent.map((attempt) => attempt.compositeScore));
    const averagePronunciation = average(attemptsForStudent.map((attempt) => attempt.pronunciationScore));
    const averageFluency = average(attemptsForStudent.map((attempt) => attempt.fluencyScore));
    const weakWordCount = new Set([
      ...masteryForStudent
        .filter((record) => statusNeedsPractice(record.masteryStatus, record.latestScore ?? record.bestScore ?? 0, record.bestScore ?? 0))
        .map((record) => normalizeWord(vocabById.get(record.vocabularyItemId)?.word ?? ''))
        .filter(Boolean),
      ...attemptsForStudent.flatMap((attempt) => pronWeakWords(attempt.metricsJson).map((word) => normalizeWord(word.word))).filter(Boolean),
    ]).size;
    const attentionReasons: string[] = [];
    if (!student.diagnosticJson) attentionReasons.push('Speaking check required');
    if (attemptsForStudent.length === 0) attentionReasons.push('No attempts in selected range');
    if (attemptsForStudent.length > 0 && averageScore < 0.65) attentionReasons.push('Low recent score');
    if (attemptsForStudent.length > 0 && averagePronunciation < 0.7) attentionReasons.push('Pronunciation below target');
    if (weakWordCount >= 3) attentionReasons.push('Several weak words');

    return {
      id: student.id,
      fullName: student.fullName,
      uniqueNumber: student.uniqueNumber,
      className: student.class,
      cefrBand: student.cefrBand,
      hasDiagnostic: !!student.diagnosticJson,
      diagnosticProfile: parseJson<Record<string, unknown> | null>(student.diagnosticJson, null),
      attempts: allAttemptsForStudent.length,
      attemptsInRange: attemptsForStudent.length,
      averageScore: round3(averageScore),
      averagePronunciation: round3(averagePronunciation),
      averageFluency: round3(averageFluency),
      averageContent: round3(average(contentScores)),
      passRate: round3(attemptsForStudent.length ? attemptsForStudent.filter((attempt) => attempt.compositeScore >= 0.75).length / attemptsForStudent.length : 0),
      masteredWords: masteryForStudent.filter((record) => record.masteryStatus === 'Mastered').length,
      developingWords: masteryForStudent.filter((record) => record.masteryStatus === 'Developing').length,
      weakWordCount,
      lastAttemptAt: allAttemptsForStudent[0]?.timestamp ?? null,
      needsAttention: attentionReasons.length > 0,
      attentionReasons,
    };
  });

  const classNames = Array.from(new Set(selectedStudents.map((student) => student.class ?? 'Unassigned'))).sort();
  const classSummaries = classNames.map((className) => {
    const members = studentSummaries.filter((student) => (student.className ?? 'Unassigned') === className);
    const attemptsForClass = filteredAttempts.filter((attempt) => (studentById.get(attempt.studentId)?.class ?? 'Unassigned') === className);
    return {
      className,
      studentCount: members.length,
      diagnosticCompletionRate: round3(members.length ? members.filter((student) => student.hasDiagnostic).length / members.length : 0),
      attempts: attemptsForClass.length,
      averageScore: round3(average(attemptsForClass.map((attempt) => attempt.compositeScore))),
      passRate: round3(attemptsForClass.length ? attemptsForClass.filter((attempt) => attempt.compositeScore >= 0.75).length / attemptsForClass.length : 0),
      averagePronunciation: round3(average(attemptsForClass.map((attempt) => attempt.pronunciationScore))),
      averageFluency: round3(average(attemptsForClass.map((attempt) => attempt.fluencyScore))),
      weakWordCount: members.reduce((sum, student) => sum + student.weakWordCount, 0),
      studentsNeedingAttention: members.filter((student) => student.needsAttention).length,
    };
  });

  const topWeakWords = Array.from(weakMap.values())
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 12)
    .map((item) => ({ ...item, averageScore: item.averageScore === null ? null : round3(item.averageScore) }));

  const audioAttempts = filteredAttempts
    .filter((attempt) => !!attempt.audioPath)
    .map((attempt) => ({
      id: attempt.id,
      studentId: attempt.studentId,
      studentName: studentById.get(attempt.studentId)?.fullName ?? 'Unknown student',
      className: studentById.get(attempt.studentId)?.class ?? null,
      timestamp: attempt.timestamp,
      audioPath: attempt.audioPath ?? '',
      transcript: attempt.transcript,
      score: round3(attempt.compositeScore),
      taskType: attempt.taskType,
      word: attempt.word,
    }));

  const allScores = filteredAttempts.map((attempt) => attempt.compositeScore);
  const contentScores = filteredAttempts.map((attempt) => contentFromMetrics(attempt.metricsJson)).filter((value): value is number => value !== null);
  const kpis: ReportKpis = {
    totalStudents: selectedStudents.length,
    activeStudents: studentSummaries.filter((student) => student.attempts > 0).length,
    diagnosticCompletionRate: round3(selectedStudents.length ? selectedStudents.filter((student) => !!student.diagnosticJson).length / selectedStudents.length : 0),
    totalAttempts: attemptRows.length,
    attemptsInRange: filteredAttempts.length,
    averageScore: round3(average(allScores)),
    passRate: round3(filteredAttempts.length ? filteredAttempts.filter((attempt) => attempt.compositeScore >= 0.75).length / filteredAttempts.length : 0),
    averagePronunciation: round3(average(filteredAttempts.map((attempt) => attempt.pronunciationScore))),
    averageFluency: round3(average(filteredAttempts.map((attempt) => attempt.fluencyScore))),
    averageContent: round3(average(contentScores)),
    weakWordCount: topWeakWords.length,
    audioAttemptCount: audioAttempts.length,
    studentsNeedingAttention: studentSummaries.filter((student) => student.needsAttention).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    filters,
    kpis,
    classes: Array.from(new Set(allStudents.map((student) => student.class ?? 'Unassigned'))).sort(),
    cefrBands: Array.from(new Set(allStudents.map((student) => student.cefrBand))).sort(),
    students: studentSummaries,
    classSummaries,
    topWeakWords,
    audioAttempts,
    recentAttempts: audioAttempts.slice(0, 8),
    deterministicInsights: buildDeterministicTeacherInsights(kpis, studentSummaries, topWeakWords),
  };
}

export function getClassReport(filters: ReportFilters = {}) {
  const overview = getReportOverview(filters);
  return {
    generatedAt: overview.generatedAt,
    filters: overview.filters,
    classes: overview.classSummaries,
    students: overview.students,
    topWeakWords: overview.topWeakWords,
  };
}

export function getStudentReport(studentId: number, filters: ReportFilters = {}) {
  const overview = getReportOverview({ ...filters, studentId });
  const student = overview.students.find((item) => item.id === studentId) ?? null;
  const attemptsForStudent = db
    .select({
      id: attempts.id,
      timestamp: attempts.timestamp,
      audioPath: attempts.audioPath,
      transcript: attempts.rawTranscript,
      targetMatchScore: attempts.targetMatchScore,
      pronunciationScore: attempts.pronunciationScore,
      fluencyScore: attempts.fluencyScore,
      completenessScore: attempts.completenessScore,
      consistencyScore: attempts.consistencyScore,
      compositeScore: attempts.compositeScore,
      metricsJson: attempts.metricsJson,
      taskType: practiceTasks.taskType,
      word: vocabularyItems.word,
    })
    .from(attempts)
    .leftJoin(practiceTasks, eq(practiceTasks.id, attempts.practiceTaskId))
    .leftJoin(vocabularyItems, eq(vocabularyItems.id, practiceTasks.vocabularyItemId))
    .where(eq(attempts.studentId, studentId))
    .orderBy(desc(attempts.timestamp))
    .all()
    .filter((attempt) => inDateRange(attempt.timestamp, filters))
    .slice(0, 50);
  return {
    generatedAt: overview.generatedAt,
    student,
    attempts: attemptsForStudent,
    weakWords: overview.topWeakWords,
    deterministicInsights: student ? buildStudentTutorInsightFromSummary(student, overview.topWeakWords).actions : [],
  };
}

export function getAudioReport(filters: ReportFilters = {}) {
  const overview = getReportOverview(filters);
  return {
    generatedAt: overview.generatedAt,
    filters: overview.filters,
    audioAttempts: overview.audioAttempts,
  };
}

export interface KlpEvidenceItem {
  klpId: number;
  conceptId: string;
  book: string | null;
  lesson: string | null;
  domain: string;
  label: string;
  supportStatus: string;
  assessmentMode: string;
  assignedCount: number;
  practicedCount: number;
  passedCount: number;
  weakCount: number;
  unattemptedCount: number;
  linkedTaskTypes: string[];
  linkedScenarios: Array<{ scenarioId: string; title: string }>;
  latestResultAt: string | null;
  latestScorePercent: number | null;
}

export interface KlpEvidenceReport {
  generatedAt: string;
  filters: ReportFilters;
  totals: {
    assigned: number;
    practiced: number;
    passed: number;
    weak: number;
    unattempted: number;
    contextOnly: number;
  };
  items: KlpEvidenceItem[];
}

function cleanNumberArray(value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed)
    ? parsed.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : [];
}

function cleanStringArray(value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed)
    ? parsed.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function addToSetMap<T>(map: Map<number, Set<T>>, key: number, value: T) {
  const set = map.get(key) ?? new Set<T>();
  set.add(value);
  map.set(key, set);
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function getKlpEvidenceReport(filters: ReportFilters = {}): KlpEvidenceReport {
  const selectedStudents = db.select().from(students).where(eq(students.isActive, true)).all().filter((student) => {
    if (filters.studentId && student.id !== filters.studentId) return false;
    if (filters.className && (student.class ?? 'Unassigned') !== filters.className) return false;
    if (filters.cefr && student.cefrBand !== filters.cefr) return false;
    return true;
  });
  const selectedStudentIds = new Set(selectedStudents.map((student) => student.id));
  const selectedStudentsById = new Map(selectedStudents.map((student) => [student.id, student]));
  const cycleIdsByStudent = new Map<number, Set<number>>();
  for (const enrollment of db.select().from(studentCycles).all()) {
    if (!selectedStudentIds.has(enrollment.studentId)) continue;
    const set = cycleIdsByStudent.get(enrollment.studentId) ?? new Set<number>();
    set.add(enrollment.cycleId);
    cycleIdsByStudent.set(enrollment.studentId, set);
  }

  const assignedStudentsByKlp = new Map<number, Set<number>>();
  const assignedTaskTypesByKlp = new Map<number, Set<string>>();
  const assignedScenarioIdsByKlp = new Map<number, Set<string>>();

  const assignments = db.select().from(homeworkAssignments).all().filter((assignment) => {
    if (assignment.source !== 'klp' || assignment.status === 'archived') return false;
    return cleanNumberArray(assignment.klpIdsJson).length > 0 || cleanStringArray(assignment.scenarioIdsJson).length > 0;
  });

  for (const assignment of assignments) {
    const klpIds = cleanNumberArray(assignment.klpIdsJson);
    if (klpIds.length === 0) continue;
    const taskTypes = cleanStringArray(assignment.taskTypes);
    const scenarioIds = cleanStringArray(assignment.scenarioIdsJson);
    const explicitStudentIds = new Set(cleanNumberArray(assignment.studentIdsJson));
    const targetStudents = selectedStudents.filter((student) => {
      if (assignment.targetType === 'student') return explicitStudentIds.has(student.id);
      if (assignment.targetType === 'cycle') return cycleIdsByStudent.get(student.id)?.has(assignment.cycleId) ?? false;
      return (student.class ?? 'Unassigned') === (assignment.className ?? 'Unassigned');
    });
    for (const klpId of klpIds) {
      for (const student of targetStudents) addToSetMap(assignedStudentsByKlp, klpId, student.id);
      for (const taskType of taskTypes) addToSetMap(assignedTaskTypesByKlp, klpId, taskType);
      for (const scenarioId of scenarioIds) addToSetMap(assignedScenarioIdsByKlp, klpId, scenarioId);
    }
  }

  const resultRows = db
    .select({
      id: attemptKlpResults.id,
      studentId: attemptKlpResults.studentId,
      klpId: attemptKlpResults.klpConceptId,
      assessmentMode: attemptKlpResults.assessmentMode,
      supportStatus: attemptKlpResults.supportStatus,
      assessed: attemptKlpResults.assessed,
      passed: attemptKlpResults.passed,
      successScorePercent: attemptKlpResults.successScorePercent,
      createdAt: attemptKlpResults.createdAt,
      conceptId: klpConcepts.conceptId,
      book: klpConcepts.book,
      lesson: klpConcepts.lesson,
      domain: klpConcepts.domain,
      baseItem: klpConcepts.baseItem,
      subtype: klpConcepts.subtype,
      definition: klpConcepts.definition,
    })
    .from(attemptKlpResults)
    .innerJoin(klpConcepts, eq(klpConcepts.id, attemptKlpResults.klpConceptId))
    .orderBy(desc(attemptKlpResults.createdAt))
    .all()
    .filter((row) => selectedStudentIds.has(row.studentId) && inDateRange(row.createdAt, filters));

  const conceptIds = new Set<number>([
    ...Array.from(assignedStudentsByKlp.keys()),
    ...resultRows.map((row) => row.klpId),
  ]);
  const conceptRows = conceptIds.size
    ? sqlite.prepare(`
        SELECT id, concept_id AS conceptId, book, lesson, domain, base_item AS baseItem,
               subtype, definition, support_status AS supportStatus
        FROM klp_concepts
        WHERE id IN (${Array.from(conceptIds).map(() => '?').join(',')})
      `).all(...Array.from(conceptIds)) as Array<{
        id: number;
        conceptId: string;
        book: string | null;
        lesson: string | null;
        domain: string;
        baseItem: string | null;
        subtype: string | null;
        definition: string | null;
        supportStatus: string;
      }>
    : [];
  const conceptById = new Map(conceptRows.map((row) => [Number(row.id), row]));

  const practicedStudentsByKlp = new Map<number, Set<number>>();
  const passedStudentsByKlp = new Map<number, Set<number>>();
  const weakStudentsByKlp = new Map<number, Set<number>>();
  const latestByStudentKlp = new Map<string, typeof resultRows[number]>();
  for (const row of resultRows) {
    addToSetMap(practicedStudentsByKlp, row.klpId, row.studentId);
    const key = `${row.studentId}:${row.klpId}`;
    if (!latestByStudentKlp.has(key)) latestByStudentKlp.set(key, row);
  }
  for (const row of latestByStudentKlp.values()) {
    const isContextOnly = row.supportStatus === 'prompt_context_only' || !row.assessed;
    if (isContextOnly) continue;
    if (row.passed && row.successScorePercent >= 75) addToSetMap(passedStudentsByKlp, row.klpId, row.studentId);
    else addToSetMap(weakStudentsByKlp, row.klpId, row.studentId);
  }

  const taskLinks = db
    .select({ klpId: practiceTaskKlps.klpConceptId, taskType: practiceTasks.taskType })
    .from(practiceTaskKlps)
    .innerJoin(practiceTasks, eq(practiceTasks.id, practiceTaskKlps.practiceTaskId))
    .all();
  const taskTypesByKlp = new Map<number, Set<string>>();
  for (const link of taskLinks) addToSetMap(taskTypesByKlp, link.klpId, link.taskType);

  const scenarioLinks = db
    .select({ klpId: scenarioKlps.klpConceptId, scenarioId: scenarioKlps.scenarioId, title: klpGeneratedScenarios.title })
    .from(scenarioKlps)
    .leftJoin(klpGeneratedScenarios, eq(klpGeneratedScenarios.scenarioId, scenarioKlps.scenarioId))
    .all();
  const scenariosByKlp = new Map<number, Map<string, string>>();
  for (const link of scenarioLinks) {
    const map = scenariosByKlp.get(link.klpId) ?? new Map<string, string>();
    map.set(link.scenarioId, link.title ?? link.scenarioId);
    scenariosByKlp.set(link.klpId, map);
  }
  for (const [klpId, ids] of assignedScenarioIdsByKlp) {
    const map = scenariosByKlp.get(klpId) ?? new Map<string, string>();
    for (const scenarioId of ids) map.set(scenarioId, map.get(scenarioId) ?? scenarioId);
    scenariosByKlp.set(klpId, map);
  }

  const latestByKlp = new Map<number, typeof resultRows[number]>();
  for (const row of resultRows) if (!latestByKlp.has(row.klpId)) latestByKlp.set(row.klpId, row);

  const items = Array.from(conceptIds).map((klpId) => {
    const concept = conceptById.get(klpId);
    const assigned = assignedStudentsByKlp.get(klpId) ?? new Set<number>();
    const practiced = practicedStudentsByKlp.get(klpId) ?? new Set<number>();
    const passed = passedStudentsByKlp.get(klpId) ?? new Set<number>();
    const weak = weakStudentsByKlp.get(klpId) ?? new Set<number>();
    const unattempted = new Set(Array.from(assigned).filter((studentId) => !practiced.has(studentId) && selectedStudentsById.has(studentId)));
    const latest = latestByKlp.get(klpId);
    const taskTypeSet = new Set<string>([
      ...(taskTypesByKlp.get(klpId) ?? []),
      ...(assignedTaskTypesByKlp.get(klpId) ?? []),
    ]);
    const scenarioMap = scenariosByKlp.get(klpId) ?? new Map<string, string>();
    return {
      klpId,
      conceptId: concept?.conceptId ?? String(klpId),
      book: concept?.book ?? null,
      lesson: concept?.lesson ?? null,
      domain: concept?.domain ?? 'Unknown',
      label: concept?.subtype || concept?.baseItem || concept?.definition || concept?.conceptId || String(klpId),
      supportStatus: concept?.supportStatus ?? latest?.supportStatus ?? 'unsupported',
      assessmentMode: latest?.assessmentMode ?? 'speaking_performance',
      assignedCount: assigned.size,
      practicedCount: practiced.size,
      passedCount: passed.size,
      weakCount: weak.size,
      unattemptedCount: unattempted.size,
      linkedTaskTypes: uniqueSorted(taskTypeSet),
      linkedScenarios: Array.from(scenarioMap.entries()).map(([scenarioId, title]) => ({ scenarioId, title })),
      latestResultAt: latest?.createdAt ?? null,
      latestScorePercent: latest?.successScorePercent ?? null,
    } satisfies KlpEvidenceItem;
  }).sort((a, b) =>
    b.unattemptedCount - a.unattemptedCount ||
    b.weakCount - a.weakCount ||
    b.assignedCount - a.assignedCount ||
    a.conceptId.localeCompare(b.conceptId),
  );

  return {
    generatedAt: new Date().toISOString(),
    filters,
    totals: {
      assigned: items.reduce((sum, item) => sum + item.assignedCount, 0),
      practiced: items.reduce((sum, item) => sum + item.practicedCount, 0),
      passed: items.reduce((sum, item) => sum + item.passedCount, 0),
      weak: items.reduce((sum, item) => sum + item.weakCount, 0),
      unattempted: items.reduce((sum, item) => sum + item.unattemptedCount, 0),
      contextOnly: items.filter((item) => item.supportStatus === 'prompt_context_only').length,
    },
    items,
  };
}

export function buildDeterministicTeacherInsights(kpis: ReportKpis, studentsList: StudentReportSummary[], weakWords: WeakWordSummary[]) {
  const insights: string[] = [];
  if (kpis.totalStudents === 0) return ['No active students are available yet. Add or enroll students before reading class progress.'];
  if (kpis.diagnosticCompletionRate < 0.8) insights.push('Prioritize the speaking check for students who have not completed it; reports are less reliable without it.');
  if (kpis.averagePronunciation > 0 && kpis.averagePronunciation < 0.7) insights.push('Pronunciation is the weakest class signal. Start with repeat and read-aloud review before open speaking tasks.');
  if (kpis.averageFluency > 0 && kpis.averageFluency < 0.65) insights.push('Fluency needs attention. Use sentence practice and fluency drills to build longer runs of speech.');
  if (weakWords.length > 0) insights.push(`The most common weak word is "${weakWords[0].word}". Review it with the class, then assign targeted practice.`);
  const atRisk = studentsList.filter((student) => student.needsAttention).slice(0, 3);
  if (atRisk.length > 0) insights.push(`Review ${atRisk.map((student) => student.fullName).join(', ')} first because they show missing diagnostics, low scores, or repeated weak words.`);
  if (insights.length === 0) insights.push('The class looks stable. Keep rotating through weak words, sentence practice, and free speaking to maintain balance.');
  return insights.slice(0, 5);
}

export function buildStudentTutorInsightFromSummary(student: StudentReportSummary, weakWords: WeakWordSummary[]) {
  const strengths: string[] = [];
  const focus: string[] = [];
  const actions: Array<{ title: string; href: string; reason: string }> = [];

  if (student.averageScore >= 0.8) strengths.push('Your recent practice scores are strong.');
  if (student.averagePronunciation >= 0.8) strengths.push('Your pronunciation is becoming clear.');
  if (student.averageFluency >= 0.75) strengths.push('Your speaking flow is improving.');
  if (student.masteredWords > 0) strengths.push(`You have mastered ${student.masteredWords} word${student.masteredWords === 1 ? '' : 's'}.`);

  if (!student.hasDiagnostic) {
    focus.push('Complete your speaking check so practice can be personalized.');
    actions.push({ title: 'Start speaking check', href: '/onboarding/diagnostic', reason: 'This sets your level and practice path.' });
  }
  if (student.averagePronunciation > 0 && student.averagePronunciation < 0.75) {
    focus.push('Pronunciation needs focused listening and repeat practice.');
    actions.push({ title: 'Repeat practice', href: '/practice?stage=repeat', reason: 'Train the target sounds before longer sentences.' });
  }
  if (student.averageFluency > 0 && student.averageFluency < 0.7) {
    focus.push('Build smoother speech with fewer short stops.');
    actions.push({ title: 'Fluency drills', href: '/practice/fluency', reason: 'Practice longer speaking runs.' });
  }
  if (student.averageContent > 0 && student.averageContent < 0.7) {
    focus.push('Make your answers into clearer complete sentences.');
    actions.push({ title: 'Sentence practice', href: '/practice?stage=sentence', reason: 'Turn vocabulary into real English sentences.' });
  }
  if (student.weakWordCount > 0) {
    focus.push('Some words still need review.');
    actions.push({ title: 'Weak Words', href: '/practice/weak-words', reason: 'Practice only the words that are holding you back.' });
  }

  const topWord = weakWords[0]?.word;
  if (topWord && !focus.some((item) => item.includes(topWord))) {
    focus.push(`Your current weak-word focus is "${topWord}".`);
  }

  if (actions.length === 0) {
    actions.push(
      { title: 'Free Speak', href: '/practice?stage=free-speak', reason: 'Use your words in original sentences.' },
      { title: 'AI Conversation', href: '/practice/conversation', reason: 'Keep natural conversation going.' },
    );
  }

  return {
    headline: focus[0] ?? 'Keep building balanced speaking skills.',
    strengths: strengths.length ? strengths.slice(0, 3) : ['You are building your speaking habit.'],
    focus: focus.length ? focus.slice(0, 4) : ['Keep practicing all modes to stay balanced.'],
    actions: actions.slice(0, 3),
  };
}

export function getStudentTutorInsight(studentId: number) {
  const overview = getReportOverview({ studentId });
  const student = overview.students[0];
  if (!student) return null;
  const klpAssignments = getKlpAssignmentsForStudent(studentId);
  const deterministic = buildStudentTutorInsightFromSummary(student, overview.topWeakWords);
  if (klpAssignments.length > 0) {
    const first = klpAssignments[0];
    deterministic.focus = [
      `Your teacher assigned "${first.title}" for KLP-linked speaking practice.`,
      ...deterministic.focus.filter((item) => !item.includes('assigned')),
    ].slice(0, 4);
    deterministic.actions = [
      {
        title: first.scenarioIds.length ? 'Assigned scenario' : 'Assigned KLP practice',
        href: first.scenarioIds.length ? '/practice/conversation?mode=scenarios' : '/practice',
        reason: first.scenarioIds.length ? 'Start the KLP role-play your teacher assigned.' : 'Work through the assigned KLP-linked tasks.',
      },
      ...deterministic.actions,
    ].slice(0, 3);
    deterministic.headline = `Start your assigned KLP practice: ${first.title}`;
  }
  return {
    student,
    deterministic,
    metrics: {
      averageScore: student.averageScore,
      averagePronunciation: student.averagePronunciation,
      averageFluency: student.averageFluency,
      averageContent: student.averageContent,
      weakWordCount: student.weakWordCount,
      masteredWords: student.masteredWords,
      assignedKlpCount: klpAssignments.reduce((sum, assignment) => sum + assignment.klpIds.length, 0),
      assignedScenarioCount: klpAssignments.reduce((sum, assignment) => sum + assignment.scenarioIds.length, 0),
      assignedKlpWork: klpAssignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate,
        targetType: assignment.targetType,
        taskTypes: assignment.taskTypes,
        klpIds: assignment.klpIds,
        scenarioIds: assignment.scenarioIds,
      })),
    },
  };
}
