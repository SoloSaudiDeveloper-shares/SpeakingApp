import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { speechReliabilityEvents, students } from '@/lib/db/schema';
import type { ReportFilters } from '@/lib/actions/report-actions';

export type SpeechReliabilityEventType = 'stt' | 'pronunciation' | 'recording' | 'tts';

export interface SpeechReliabilityEventInput {
  studentId?: number | null;
  userId?: number | null;
  className?: string | null;
  eventType: SpeechReliabilityEventType;
  provider: string;
  route: string;
  practiceStage?: string | null;
  scenarioId?: string | null;
  practiceTaskId?: number | null;
  success: boolean;
  statusCode?: number | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  noSpeech?: boolean | null;
  fallbackUsed?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

export interface SpeechReliabilityReport {
  generatedAt: string;
  filters: ReportFilters;
  kpis: {
    sttSuccessRate: number;
    azurePronunciationAvailability: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    failedRecordings: number;
    noSpeechAttempts: number;
    fallbackRate: number;
    totalEvents: number;
  };
  providerBreakdown: Array<{
    provider: string;
    total: number;
    successRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    failures: number;
    noSpeechAttempts: number;
  }>;
  classBreakdown: Array<{
    className: string;
    total: number;
    sttSuccessRate: number;
    azurePronunciationAvailability: number;
    failedRecordings: number;
    noSpeechAttempts: number;
    averageLatencyMs: number;
  }>;
  recentIssues: Array<{
    id: number;
    studentId: number | null;
    studentName: string | null;
    className: string | null;
    eventType: string;
    provider: string;
    route: string;
    practiceStage: string | null;
    scenarioId: string | null;
    success: boolean;
    statusCode: number | null;
    errorCode: string | null;
    latencyMs: number;
    noSpeech: boolean;
    fallbackUsed: boolean;
    createdAt: string;
  }>;
}

type ReliabilityRow = typeof speechReliabilityEvents.$inferSelect;

const BLOCKED_METADATA_KEYS = /transcript|audio|blob|file|key|token|secret|providerBody|raw/i;
const SAFE_TTS_METADATA_KEYS = new Set([
  'characters',
  'audio_bytes',
  'ttfb_ms',
  'total_ms',
  'stream_outcome',
]);

function sanitizeString(value: unknown, max = 120) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function sanitizeNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (BLOCKED_METADATA_KEYS.test(key) && !SAFE_TTS_METADATA_KEYS.has(key)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 160);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key] = value;
  }
  return safe;
}

function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function average(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function p95(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!clean.length) return 0;
  return clean[Math.min(clean.length - 1, Math.ceil(clean.length * 0.95) - 1)];
}

function inDateRange(value: string, filters: ReportFilters) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  if (filters.from) {
    const from = new Date(filters.from);
    if (Number.isFinite(from.getTime()) && timestamp < from.getTime()) return false;
  }
  if (filters.to) {
    const to = new Date(filters.to);
    if (Number.isFinite(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      if (timestamp > to.getTime()) return false;
    }
  }
  return true;
}

function rowMatchesFilters(row: ReliabilityRow, filters: ReportFilters, selectedStudentIds: Set<number>) {
  if (!inDateRange(row.createdAt, filters)) return false;
  if (filters.studentId) return row.studentId === filters.studentId;
  if (row.studentId && selectedStudentIds.size > 0) return selectedStudentIds.has(row.studentId);
  if (filters.className) return (row.className ?? 'Unassigned') === filters.className;
  return true;
}

function eventMatches(row: ReliabilityRow, eventType: SpeechReliabilityEventType) {
  return row.eventType === eventType;
}

export async function recordSpeechReliabilityEvent(input: SpeechReliabilityEventInput) {
  const student = input.studentId
    ? ((await db.select({ className: students.class }).from(students).where(eq(students.id, input.studentId)).limit(1))[0])
    : null;
  const latencyMs = sanitizeNumber(input.latencyMs) ?? 0;

  return ((await db.insert(speechReliabilityEvents).values({
    studentId: input.studentId ?? null,
    userId: input.userId ?? null,
    className: sanitizeString(input.className) ?? student?.className ?? null,
    eventType: input.eventType,
    provider: sanitizeString(input.provider, 80) ?? 'unknown',
    route: sanitizeString(input.route, 120) ?? 'unknown',
    practiceStage: sanitizeString(input.practiceStage, 60),
    scenarioId: sanitizeString(input.scenarioId, 120),
    practiceTaskId: input.practiceTaskId && Number.isInteger(input.practiceTaskId) ? input.practiceTaskId : null,
    success: !!input.success,
    statusCode: sanitizeNumber(input.statusCode),
    errorCode: sanitizeString(input.errorCode, 80),
    latencyMs,
    noSpeech: !!input.noSpeech,
    fallbackUsed: !!input.fallbackUsed,
    metadataJson: JSON.stringify(sanitizeMetadata(input.metadata)),
    createdAt: new Date().toISOString(),
  }).returning())[0]);
}

export async function getSpeechReliabilityReport(filters: ReportFilters = {}): Promise<SpeechReliabilityReport> {
  const selectedStudents = (await db.select().from(students).where(eq(students.isActive, true))).filter((student) => {
    if (filters.studentId && student.id !== filters.studentId) return false;
    if (filters.className && (student.class ?? 'Unassigned') !== filters.className) return false;
    if (filters.cefr && student.cefrBand !== filters.cefr) return false;
    return true;
  });
  const studentById = new Map(selectedStudents.map((student) => [student.id, student]));
  const selectedStudentIds = new Set(selectedStudents.map((student) => student.id));
  const rows = (await db
    .select()
    .from(speechReliabilityEvents)
    .orderBy(desc(speechReliabilityEvents.createdAt)))
    .filter((row) => rowMatchesFilters(row, filters, selectedStudentIds));

  const sttEvents = rows.filter((row) => eventMatches(row, 'stt'));
  const pronunciationEvents = rows.filter((row) => eventMatches(row, 'pronunciation'));
  const failedRecordingEvents = rows.filter((row) => eventMatches(row, 'recording') && !row.success);
  const latencies = rows.map((row) => row.latencyMs);

  const providerNames = Array.from(new Set(rows.map((row) => row.provider || 'unknown'))).sort();
  const providerBreakdown = providerNames.map((provider) => {
    const providerRows = rows.filter((row) => (row.provider || 'unknown') === provider);
    return {
      provider,
      total: providerRows.length,
      successRate: rate(providerRows.filter((row) => row.success).length, providerRows.length),
      averageLatencyMs: average(providerRows.map((row) => row.latencyMs)),
      p95LatencyMs: p95(providerRows.map((row) => row.latencyMs)),
      failures: providerRows.filter((row) => !row.success).length,
      noSpeechAttempts: providerRows.filter((row) => row.noSpeech).length,
    };
  });

  const classNames = Array.from(new Set([
    ...selectedStudents.map((student) => student.class ?? 'Unassigned'),
    ...rows.map((row) => row.className ?? 'Unassigned'),
  ])).sort();
  const classBreakdown = classNames.map((className) => {
    const classRows = rows.filter((row) => (row.className ?? 'Unassigned') === className);
    const classStt = classRows.filter((row) => eventMatches(row, 'stt'));
    const classPronunciation = classRows.filter((row) => eventMatches(row, 'pronunciation'));
    return {
      className,
      total: classRows.length,
      sttSuccessRate: rate(classStt.filter((row) => row.success).length, classStt.length),
      azurePronunciationAvailability: rate(classPronunciation.filter((row) => row.success).length, classPronunciation.length),
      failedRecordings: classRows.filter((row) => eventMatches(row, 'recording') && !row.success).length,
      noSpeechAttempts: classRows.filter((row) => row.noSpeech).length,
      averageLatencyMs: average(classRows.map((row) => row.latencyMs)),
    };
  }).filter((item) => item.total > 0 || !filters.className);

  return {
    generatedAt: new Date().toISOString(),
    filters,
    kpis: {
      sttSuccessRate: rate(sttEvents.filter((row) => row.success).length, sttEvents.length),
      azurePronunciationAvailability: rate(pronunciationEvents.filter((row) => row.success).length, pronunciationEvents.length),
      averageLatencyMs: average(latencies),
      p95LatencyMs: p95(latencies),
      failedRecordings: failedRecordingEvents.length,
      noSpeechAttempts: rows.filter((row) => row.noSpeech).length,
      fallbackRate: rate(rows.filter((row) => row.fallbackUsed).length, rows.length),
      totalEvents: rows.length,
    },
    providerBreakdown,
    classBreakdown,
    recentIssues: rows
      .filter((row) => !row.success || row.noSpeech)
      .slice(0, 20)
      .map((row) => ({
        id: row.id,
        studentId: row.studentId,
        studentName: row.studentId ? studentById.get(row.studentId)?.fullName ?? null : null,
        className: row.className,
        eventType: row.eventType,
        provider: row.provider,
        route: row.route,
        practiceStage: row.practiceStage,
        scenarioId: row.scenarioId,
        success: row.success,
        statusCode: row.statusCode,
        errorCode: row.errorCode,
        latencyMs: row.latencyMs,
        noSpeech: row.noSpeech,
        fallbackUsed: row.fallbackUsed,
        createdAt: row.createdAt,
      })),
  };
}

export async function countSpeechReliabilityEventsForQualityCheck() {
  const row = (await db.select({ count: sql<number>`count(*)::int` }).from(speechReliabilityEvents))[0];
  return Number(row?.count ?? 0);
}
