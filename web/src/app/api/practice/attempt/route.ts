import { requireStudent } from '@/lib/auth/authorization';
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
  attempts,
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
import {
  PRACTICE_ATTEMPT_BODY_MAX_BYTES,
  parseBoundedPracticePayload,
} from '@/lib/security/practice-payload';
import {
  jsonBodyErrorResponse,
  readBoundedJson,
} from '@/lib/security/request-body';
import {
  consumeCloudAiBudgetIfNeeded,
  consumePracticeAttemptBudget,
  ResourceBudgetExceededError,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';
import { mutationRequestViolation } from '@/lib/security/request-protection';
import { practiceAttemptReplayPayload } from '@/lib/security/practice-attempt-replay';

type PracticeStage = 'listen' | 'repeat' | 'read-aloud' | 'sentence' | 'free-speak' | 'review';

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function coerceBand(value: unknown): CefrBand {
  return value === 'A2' || value === 'B1' || value === 'B2' ? value : 'A1';
}

function clientSubmissionId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) return '';
  return value;
}

function legacyAudioPath(value: unknown, studentId: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    normalized.includes('..') ||
    !normalized.startsWith(`${studentId}/`)
  ) {
    return '';
  }
  return normalized;
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
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const word = typeof obj.word === 'string' ? obj.word.trim().slice(0, 100) : '';
    const accuracy = finiteNumber(obj.accuracy);
    const errorType = typeof obj.errorType === 'string' ? obj.errorType.slice(0, 100) : '';
    const stage = typeof obj.stage === 'string' ? obj.stage.slice(0, 50) : '';
    const capturedAt = typeof obj.capturedAt === 'string' ? obj.capturedAt.slice(0, 64) : new Date().toISOString();
    if (!word || accuracy === null || !errorType || !stage) return [];
    const weakPhonemes = Array.isArray(obj.weakPhonemes)
      ? obj.weakPhonemes.slice(0, 20).flatMap((phoneme) => {
          if (!phoneme || typeof phoneme !== 'object') return [];
          const p = phoneme as Record<string, unknown>;
          const phonemeName = typeof p.phoneme === 'string' ? p.phoneme.slice(0, 32) : '';
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
    const violation = mutationRequestViolation(request);
    if (violation) return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    const auth = await requireStudent();
    if (!auth.ok) return auth.response;
    const user = auth.user;
    const studentId = user.studentId!;

    const rawBody = await readBoundedJson(request, PRACTICE_ATTEMPT_BODY_MAX_BYTES);
    const payload = parseBoundedPracticePayload(rawBody);
    if (!payload.ok) return Response.json({ error: payload.error }, { status: 400 });
    const body = payload.body;
    const submissionId = clientSubmissionId(body.clientSubmissionId);
    if (submissionId === '') {
      return Response.json({ error: 'Invalid clientSubmissionId.' }, { status: 400 });
    }
    const audioPath = legacyAudioPath(body.audioPath, studentId);
    if (audioPath === '') {
      return Response.json({ error: 'Invalid audioPath.' }, { status: 400 });
    }
    const cycleId = toPositiveInt(body.cycleId);
    const practiceTaskId = toPositiveInt(body.practiceTaskId);
    if (!cycleId || !practiceTaskId) {
      return Response.json({ error: 'Missing or invalid cycleId/practiceTaskId.' }, { status: 400 });
    }

    const enrollment = ((await db
      .select()
      .from(studentCycles)
      .where(and(eq(studentCycles.studentId, studentId), eq(studentCycles.cycleId, cycleId))).limit(1))[0]);
    if (!enrollment) return Response.json({ error: 'Not enrolled in this cycle.' }, { status: 403 });

    const student = ((await db.select().from(students).where(eq(students.id, studentId)).limit(1))[0]);
    const cycle = ((await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1))[0]);
    if (!cycle) return Response.json({ error: 'Cycle not found.' }, { status: 404 });

    const book = ((await db.select().from(books).where(eq(books.id, cycle.bookId)).limit(1))[0]);
    const task = ((await db
      .select()
      .from(practiceTasks)
      .where(and(eq(practiceTasks.id, practiceTaskId), eq(practiceTasks.bookId, cycle.bookId))).limit(1))[0]);
    if (!task) return Response.json({ error: 'Practice task not found for this cycle.' }, { status: 404 });

    if (submissionId) {
      const existingAttempt = (await db
        .select()
        .from(attempts)
        .where(and(
          eq(attempts.studentId, studentId),
          eq(attempts.clientSubmissionId, submissionId),
        ))
        .limit(1))[0];
      if (existingAttempt) {
        if (
          existingAttempt.cycleId !== cycleId ||
          existingAttempt.practiceTaskId !== practiceTaskId
        ) {
          return Response.json(
            { error: 'clientSubmissionId was already used for another attempt.' },
            { status: 409 },
          );
        }
        return Response.json(practiceAttemptReplayPayload(existingAttempt), { status: 200 });
      }
    }

    const vocabulary = task.vocabularyItemId
      ? ((await db.select().from(vocabularyItems).where(eq(vocabularyItems.id, task.vocabularyItemId)).limit(1))[0])
      : null;

    const mastery = task.vocabularyItemId
      ? ((await db
          .select()
          .from(wordMasteryRecords)
          .where(and(
            eq(wordMasteryRecords.studentId, studentId),
            eq(wordMasteryRecords.vocabularyItemId, task.vocabularyItemId),
            eq(wordMasteryRecords.cycleId, cycleId),
          )).limit(1))[0])
      : null;

    const transcript = payload.transcript;
    const clientMetrics = payload.metrics;
    const bodyDuration = finiteNumber(body.audioDurationSeconds) ?? finiteNumber(body.durationSeconds) ?? 0;
    const durationSeconds = Math.min(
      600,
      numericMetric(clientMetrics, ['audioDurationSeconds', 'durationSeconds'], bodyDuration),
    );
    const practiceStage = coercePracticeStage(clientMetrics.practiceStage);
    const cefrBand = coerceBand(student?.cefrBand ?? book?.cefrLevel);
    const expectedAnswersJson =
      practiceStage === 'sentence' && vocabulary?.exampleSentence
        ? JSON.stringify([vocabulary.exampleSentence])
        : task.expectedAnswers ?? (vocabulary?.word ? JSON.stringify([vocabulary.word]) : null);

    await consumePracticeAttemptBudget(user.id);

    if (practiceStage === 'free-speak') {
      const metrics = asFluencyMetrics(clientMetrics) ?? computeFluencyMetrics({
        transcript,
        audioDurationSeconds: durationSeconds,
        cefrBand,
      });
      let aiGrade = null;
      try {
        await consumeCloudAiBudgetIfNeeded(user.id);
        aiGrade = await gradeOpenResponseContent({
          transcript,
          topic: `Vocabulary Free Speak for "${vocabulary?.word ?? ''}". Judge coherence only; the app checks target vocabulary use separately.`,
          fluencyMetrics: metrics,
        });
      } catch (error) {
        if (!(error instanceof ResourceBudgetExceededError)) throw error;
      }
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

      const result = await recordAttempt({
        studentId,
        clientSubmissionId: submissionId,
        cycleId,
        bookId: cycle.bookId,
        practiceTaskId,
        audioPath,
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
      const klpResults = result.idempotentReplay
        ? []
        : await recordAttemptKlpResults({
            attemptId: result.id,
            studentId,
            practiceTaskId,
            scores: free.scores,
            passScore: task.passScore,
            evidenceKind: 'answered',
          });
      if (!result.idempotentReplay) after(() => drainXapiOutbox());

      return Response.json({
        attempt: result,
        score: free.scores,
        feedback: free.feedback,
        freeSpeak: free.metadata,
        klpResults,
        idempotentReplay: result.idempotentReplay,
      }, { status: result.idempotentReplay ? 200 : 201 });
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

    const result = await recordAttempt({
      studentId,
      clientSubmissionId: submissionId,
      cycleId,
      bookId: cycle.bookId,
      practiceTaskId,
      audioPath,
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
    const klpResults = result.idempotentReplay
      ? []
      : await recordAttemptKlpResults({
          attemptId: result.id,
          studentId,
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
    if (!result.idempotentReplay) after(() => drainXapiOutbox());

    return Response.json({
      attempt: result,
      score,
      feedback,
      klpResults,
      idempotentReplay: result.idempotentReplay,
    }, { status: result.idempotentReplay ? 200 : 201 });
  } catch (error) {
    const bodyResponse = jsonBodyErrorResponse(error);
    if (bodyResponse) return bodyResponse;
    const budgetResponse = resourceBudgetResponse(error);
    if (budgetResponse) return budgetResponse;
    console.error('Practice attempt save error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
