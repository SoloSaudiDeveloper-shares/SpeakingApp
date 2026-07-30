import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { gradeOpenResponseContent } from '@/lib/ai/content-grade';
import { PRACTICE_TRANSCRIPT_MAX_CHARS } from '@/lib/security/practice-payload';
import { jsonBodyErrorResponse, readBoundedJson } from '@/lib/security/request-body';
import {
  consumeCloudAiBudgetIfNeeded,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';
import { mutationRequestViolation } from '@/lib/security/request-protection';

/**
 * POST /api/practice/content-grade
 * Body: { transcript: string, topic?: string, fluencyMetrics?: object }
 *
 * Semantic content check for open spoken tasks. The app owns deterministic
 * numeric fluency scoring; the AI only judges coherence and explains the
 * measured fluency metrics in one short comment.
 */
export async function POST(request: Request) {
  try {
    const violation = mutationRequestViolation(request);
    if (violation) return Response.json({ error: 'Request is not allowed.' }, { status: 403 });
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const rawBody = await readBoundedJson(request, 64 * 1024);
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return Response.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const body = rawBody as Record<string, unknown>;
    const transcript = String(body.transcript ?? '').trim();
    const topic = String(body.topic ?? '').trim();
    if (transcript.length > PRACTICE_TRANSCRIPT_MAX_CHARS || topic.length > 2_000) {
      return Response.json({ error: 'Practice text is too large.' }, { status: 400 });
    }
    const fluencyMetrics = body.fluencyMetrics && typeof body.fluencyMetrics === 'object'
      ? body.fluencyMetrics
      : null;
    if (JSON.stringify(fluencyMetrics).length > 32 * 1024) {
      return Response.json({ error: 'Fluency metrics are too large.' }, { status: 400 });
    }

    await consumeCloudAiBudgetIfNeeded(user.id);
    return Response.json(await gradeOpenResponseContent({ transcript, topic, fluencyMetrics }));
  } catch (e) {
    const bodyResponse = jsonBodyErrorResponse(e);
    if (bodyResponse) return bodyResponse;
    const budgetResponse = resourceBudgetResponse(e);
    if (budgetResponse) return budgetResponse;
    console.error('content-grade error:', e);
    return Response.json({
      coherence: null,
      reason: null,
      fluencyComment: null,
      aiAvailable: false,
      provider: 'ollama',
      model: 'unknown',
    });
  }
}
