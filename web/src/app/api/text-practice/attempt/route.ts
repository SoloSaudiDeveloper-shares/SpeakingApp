import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { recordTextAttempt } from '@/lib/actions/text-practice-actions';
import { db } from '@/lib/db';
import { studentTexts } from '@/lib/db/schema';
import { compareTextToTranscript } from '@/lib/scoring/text-comparison';
import { computeFluencyMetrics } from '@/lib/scoring/fluency-metrics';
import { and, eq } from 'drizzle-orm';
import { PRACTICE_TRANSCRIPT_MAX_CHARS } from '@/lib/security/practice-payload';
import { jsonBodyErrorResponse, readBoundedJson } from '@/lib/security/request-body';
import {
  consumePracticeAttemptBudget,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';
import { mutationRequestViolation } from '@/lib/security/request-protection';

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toNonNegativeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function POST(request: Request) {
  try {
    const violation = mutationRequestViolation(request);
    if (violation) return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const rawBody = await readBoundedJson(request, 32 * 1024);
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return Response.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const body = rawBody as Record<string, unknown>;
    const {
      studentTextId,
      spokenTranscript,
      durationSeconds,
    } = body;

    const textId = toPositiveInt(studentTextId);
    if (!textId || spokenTranscript === undefined) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    const text = ((await db
      .select()
      .from(studentTexts)
      .where(and(eq(studentTexts.id, textId), eq(studentTexts.studentId, user.studentId))).limit(1))[0]);
    if (!text) return Response.json({ error: 'Text not found.' }, { status: 404 });

    const transcript = typeof spokenTranscript === 'string' ? spokenTranscript : '';
    if (transcript.length > PRACTICE_TRANSCRIPT_MAX_CHARS) {
      return Response.json({ error: 'Transcript is too large.' }, { status: 400 });
    }
    const duration = Math.min(600, toNonNegativeNumber(durationSeconds));
    await consumePracticeAttemptBudget(user.id);
    const comparison = compareTextToTranscript(text.originalText, transcript);
    const fluency = computeFluencyMetrics({
      transcript,
      audioDurationSeconds: duration,
      cefrBand: 'A1',
    });

    const attempt = await recordTextAttempt({
      studentTextId: textId,
      studentId: user.studentId,
      spokenTranscript: transcript,
      accuracyScore: comparison.accuracyScore,
      pronunciationScore: 0,
      fluencyScore: Math.round(fluency.fluencyIndex * 100),
      completenessScore: comparison.completenessScore,
      weakWords: comparison.weakWords,
      durationSeconds: duration,
    });

    return Response.json({ attempt });
  } catch (error) {
    const bodyResponse = jsonBodyErrorResponse(error);
    if (bodyResponse) return bodyResponse;
    const budgetResponse = resourceBudgetResponse(error);
    if (budgetResponse) return budgetResponse;
    console.error('Text attempt save error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
