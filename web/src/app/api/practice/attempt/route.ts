import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { recordAttempt } from '@/lib/actions/practice-actions';
import { recordAttemptKlpResults } from '@/lib/actions/klp-actions';
import { gradeOpenResponseContent } from '@/lib/ai/content-grade';
import { db } from '@/lib/db';
import {
  computeFluencyMetrics,
  generateFeedback,
  scoreFreeSpeak,
  type FluencyMetrics,
  type PronunciationWeakWordEvidence,
} from '@/lib/scoring';
import {
  books,
  cycles,
  practiceTasks,
  studentCycles,
  students,
  vocabularyItems,
  wordMasteryRecords,
} from '@/lib/db/schema';
import { calculateScore, type CefrBand } from '@/lib/scoring/score-calculator';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { drainXapiOutbox } from '@/lib/integrations/xapi';

type PracticeStage = 'listen' | 'repeat' | 'read-aloud' | 'sentence' | 'free-speak' | 'review';

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function coerceBand(value: unknown): CefrBand {
  return value === 'A2' || value === 'B1' || value === 'B2' ? value : 'A1';
}

function parseMetricsJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numericMetric(metrics: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = metrics[key];
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asFluencyMetrics(metrics: Record<string, unknown>): FluencyMetrics | null {
  const required = [
    'schemaVersion',
    'wordCount',
    'audioDurationSeconds',
    'speechRateWpm',
    'articulationRateWpm',
    'pauseCount',
    'pausePerMin',
    'totalPauseSeconds',
    'meanLengthOfRun',
    'fluencyIndex',
  ];
  if (!required.every((key) => finiteNumber(metrics[key]) !== null)) return null;
  return {
    schemaVersion: 1,
    wordCount: finiteNumber(metrics.wordCount) ?? 0,
    audioDurationSeconds: finiteNumber(metrics.audioDurationSeconds) ?? 0,
    speechRateWpm: finiteNumber(metrics.speechRateWpm) ?? 0,
    articulationRateWpm: finiteNumber(metrics.articulationRateWpm) ?? 0,
    pauseCount: finiteNumber(metrics.pauseCount) ?? 0,
    pausePerMin: finiteNumber(metrics.pausePerMin) ?? 0,
    totalPauseSeconds: finiteNumber(metrics.totalPauseSeconds) ?? 0,
    meanLengthOfRun: finiteNumber(metrics.meanLengthOfRun) ?? 0,
    fluencyIndex: finiteNumber(metrics.fluencyIndex) ?? 0,
  };
}

function parsePronunciationEvidence(value: unknown): PronunciationWeakWordEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const word = typeof obj.word === 'string' ? obj.word.trim() : '';
    const accuracy = finiteNumber(obj.accuracy);
    const errorType = typeof obj.errorType === 'string' ? obj.errorType : '';
    const stage = typeof obj.stage === 'string' ? obj.stage : '';
    const capturedAt = typeof obj.capturedAt === 'string' ? obj.capturedAt : new Date().toISOString();
    if (!word || accuracy === null || !errorType || !stage) return [];
    const weakPhonemes = Array.isArray(obj.weakPhonemes)
      ? obj.weakPhonemes.flatMap((phoneme) => {
          if (!phoneme || typeof phoneme !== 'object') return [];
          const p = phoneme as Record<string, unknown>;
          const phonemeName = typeof p.phoneme === 'string' ? p.phoneme : '';
          const phonemeAccuracy = finiteNumber(p.accuracy);
          return phonemeName && phonemeAccuracy !== null ? [{ phoneme: phonemeName, accuracy: phonemeAccuracy }] : [];
        })
      : [];
    return [{ word, accuracy, errorType, weakPhonemes, stage, capturedAt }];
  });
}

function coercePracticeStage(value: unknown): PracticeStage {
  return value === 'listen' ||
    value === 'repeat' ||
    value === 'read-aloud' ||
    value === 'sentence' ||
    value === 'free-speak' ||
    value === 'review'
    ? value
    : 'repeat';
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user || !user.studentId) return Response.json({ error: 'Not authorized.' }, { status: 403 });

    const body = await request.json();
    const cycleId = toPositiveInt(body.cycleId);
    const practiceTaskId = toPositiveInt(body.practiceTaskId);
    if (!cycleId || !practiceTaskId) {
      return Response.json({ error: 'Missing or invalid cycleId/practiceTaskId.' }, { status: 400 });
    }

    const enrollment = db
      .select()
      .from(studentCycles)
      .where(and(eq(studentCycles.studentId, user.studentId), eq(studentCycles.cycleId, cycleId)))
      .get();
    if (!enrollment) return Response.json({ error: 'Not enrolled in this cycle.' }, { status: 403 });

    const student = db.select().from(students).where(eq(students.id, user.studentId)).get();
    const cycle = db.select().from(cycles).where(eq(cycles.id, cycleId)).get();
    if (!cycle) return Response.json({ error: 'Cycle not found.' }, { status: 404 });

    const book = db.select().from(books).where(eq(books.id, cycle.bookId)).get();
    const task = db
      .select()
      .from(practiceTasks)
      .where(and(eq(practiceTasks.id, practiceTaskId), eq(practiceTasks.bookId, cycle.bookId)))
      .get();
    if (!task) return Response.json({ error: 'Practice task not found for this cycle.' }, { status: 404 });

    const vocabulary = task.vocabularyItemId
      ? db.select().from(vocabularyItems).where(eq(vocabularyItems.id, task.vocabularyItemId)).get()
      : null;

    const mastery = task.vocabularyItemId
      ? db
          .select()
          .from(wordMasteryRecords)
          .where(and(
            eq(wordMasteryRecords.studentId, user.studentId),
            eq(wordMasteryRecords.vocabularyItemId, task.vocabularyItemId),
            eq(wordMasteryRecords.cycleId, cycleId),
          ))
          .get()
      : null;

    const transcript = typeof body.rawTranscript === 'string' ? body.rawTranscript : '';
    const clientMetrics = parseMetricsJson(body.metricsJson);
    const bodyDuration = finiteNumber(body.audioDurationSeconds) ?? finiteNumber(body.durationSeconds) ?? 0;
    const durationSeconds = numericMetric(clientMetrics, ['audioDurationSeconds', 'durationSeconds'], bodyDuration);
    const practiceStage = coercePracticeStage(clientMetrics.practiceStage);
    const cefrBand = coerceBand(student?.cefrBand ?? book?.cefrLevel);
    const expectedAnswersJson =
      practiceStage === 'sentence' && vocabulary?.exampleSentence
        ? JSON.stringify([vocabulary.exampleSentence])
        : task.expectedAnswers ?? (vocabulary?.word ? JSON.stringify([vocabulary.word]) : null);

    if (practiceStage === 'free-speak') {
      const metrics = asFluencyMetrics(clientMetrics) ?? computeFluencyMetrics({
        transcript,
        audioDurationSeconds: durationSeconds,
        cefrBand,
      });
      const aiGrade = await gradeOpenResponseContent({
        transcript,
        topic: `Vocabulary Free Speak for "${vocabulary?.word ?? ''}". Judge coherence only; the app checks target vocabulary use separately.`,
        fluencyMetrics: metrics,
      });
      const free = scoreFreeSpeak({
        transcript,
        targetText: vocabulary?.word ?? null,
        requireTargetText: true,
        audioDurationSeconds: durationSeconds,
        cefrBand,
        fluencyMetrics: metrics,
        aiGrade,
        bestPreviousScore: mastery?.bestScore ?? 0,
        latestPreviousScore: mastery?.latestScore ?? 0,
        previousAttemptCount: mastery?.timesSpoken ?? 0,
      });

      const result = recordAttempt({
        studentId: user.studentId,
        cycleId,
        bookId: cycle.bookId,
        practiceTaskId,
        audioPath: typeof body.audioPath === 'string' ? body.audioPath : undefined,
        rawTranscript: transcript,
        targetMatchScore: free.scores.targetMatch,
        pronunciationScore: free.scores.pronunciation,
        fluencyScore: free.scores.fluency,
        completenessScore: free.scores.completeness,
        consistencyScore: free.scores.consistency,
        compositeScore: free.scores.composite,
        metricsJson: JSON.stringify({
          ...clientMetrics,
          ...metrics,
          practiceStage,
          audioDurationSeconds: durationSeconds,
          freeSpeak: free.metadata,
          pronunciationWeakWords: parsePronunciationEvidence(clientMetrics.pronunciationWeakWords),
          serverScored: true,
          clientScoresIgnored: true,
        }),
      });
      const klpResults = recordAttemptKlpResults({
        attemptId: result.id,
        studentId: user.studentId,
        practiceTaskId,
        scores: free.scores,
        passScore: task.passScore,
        evidenceKind: 'answered',
      });
      after(() => drainXapiOutbox());

      return Response.json({ attempt: result, score: free.scores, feedback: free.feedback, freeSpeak: free.metadata, klpResults });
    }

    const score = calculateScore({
      transcript,
      expectedAnswersJson,
      spokenPhonemes: null,
      referencePhonemes: vocabulary?.phonemeString ?? null,
      audioDurationSeconds: durationSeconds,
      bestPreviousScore: mastery?.bestScore ?? 0,
      latestPreviousScore: mastery?.latestScore ?? 0,
      previousAttemptCount: mastery?.timesSpoken ?? 0,
      cefrBand,
    });
    let expectedList: string[] = [];
    try {
      const parsed = expectedAnswersJson ? JSON.parse(expectedAnswersJson) : [];
      if (Array.isArray(parsed)) expectedList = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      expectedList = [];
    }
    if (expectedList.length === 0 && vocabulary?.word) expectedList = [vocabulary.word];
    const feedback = generateFeedback(score, transcript, expectedList, durationSeconds);

    const result = recordAttempt({
      studentId: user.studentId,
      cycleId,
      bookId: cycle.bookId,
      practiceTaskId,
      audioPath: typeof body.audioPath === 'string' ? body.audioPath : undefined,
      rawTranscript: transcript,
      targetMatchScore: score.targetMatch,
      pronunciationScore: score.pronunciation,
      fluencyScore: score.fluency,
      completenessScore: score.completeness,
      consistencyScore: score.consistency,
      compositeScore: score.composite,
      metricsJson: JSON.stringify({
        ...clientMetrics,
        practiceStage,
        audioDurationSeconds: durationSeconds,
        serverScored: true,
        clientScoresIgnored: true,
      }),
    });
    const klpResults = recordAttemptKlpResults({
      attemptId: result.id,
      studentId: user.studentId,
      practiceTaskId,
      scores: {
        targetMatch: score.targetMatch,
        pronunciation: score.pronunciation,
        fluency: score.fluency,
        completeness: score.completeness,
        consistency: score.consistency,
        composite: score.composite,
      },
      passScore: task.passScore,
      evidenceKind: practiceStage === 'review' ? 'reviewed' : 'answered',
    });
    after(() => drainXapiOutbox());

    return Response.json({ attempt: result, score, feedback, klpResults });
  } catch (error) {
    console.error('Practice attempt save error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
