import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { recordSpeechReliabilityEvent, type SpeechReliabilityEventType } from '@/lib/actions/speech-reliability-actions';

const BLOCKED_BODY_KEYS = /transcript|audio|blob|file|key|token|secret|providerBody|raw/i;

function eventType(value: unknown): SpeechReliabilityEventType {
  return value === 'pronunciation' || value === 'recording' ? value : 'stt';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function assertNoSensitiveKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (BLOCKED_BODY_KEYS.test(key)) {
      throw new Error(`Reliability telemetry must not include "${key}".`);
    }
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid event.' }, { status: 400 });
    assertNoSensitiveKeys(body);
    assertNoSensitiveKeys((body as Record<string, unknown>).metadata);

    const event = await recordSpeechReliabilityEvent({
      userId: user.id,
      studentId: user.studentId,
      eventType: eventType((body as Record<string, unknown>).eventType),
      provider: stringValue((body as Record<string, unknown>).provider) ?? 'client',
      route: stringValue((body as Record<string, unknown>).route) ?? 'client',
      practiceStage: stringValue((body as Record<string, unknown>).practiceStage),
      scenarioId: stringValue((body as Record<string, unknown>).scenarioId),
      practiceTaskId: numberValue((body as Record<string, unknown>).practiceTaskId),
      success: Boolean((body as Record<string, unknown>).success),
      statusCode: numberValue((body as Record<string, unknown>).statusCode),
      errorCode: stringValue((body as Record<string, unknown>).errorCode),
      latencyMs: numberValue((body as Record<string, unknown>).latencyMs),
      noSpeech: Boolean((body as Record<string, unknown>).noSpeech),
      fallbackUsed: Boolean((body as Record<string, unknown>).fallbackUsed),
      metadata: ((body as Record<string, unknown>).metadata && typeof (body as Record<string, unknown>).metadata === 'object')
        ? (body as Record<string, unknown>).metadata as Record<string, unknown>
        : null,
    });

    return Response.json({ ok: true, id: event.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not record reliability event.';
    const status = /must not include/i.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
