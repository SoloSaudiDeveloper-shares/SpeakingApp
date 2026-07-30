import {
  getCloudTtsReadiness,
  getTtsProviderPolicy,
  saveTtsProviderPolicy,
  TtsConfigConflictError,
} from '@/lib/speech/tts-config-server';
import { rejectCrossOriginMutation, requireTtsAdmin } from '@/lib/speech/tts-route-auth';
import { getTtsUsage } from '@/lib/speech/tts-usage-server';

export async function GET() {
  const auth = await requireTtsAdmin();
  if ('response' in auth) return auth.response;
  try {
    const [{ policy, source }, readiness] = await Promise.all([
      getTtsProviderPolicy(),
      getCloudTtsReadiness(),
    ]);
    const effectiveUsage = await getTtsUsage(policy);
    return Response.json(
      { policy, source, readiness, effectiveUsage },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'TTS configuration is unavailable.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function PUT(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const auth = await requireTtsAdmin();
  if ('response' in auth) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const unknownKey = Object.keys(body).find((key) => !['expectedVersion', 'policy'].includes(key));
  if (unknownKey || !Number.isSafeInteger(body.expectedVersion) || !body.policy) {
    return Response.json({ error: 'Invalid TTS configuration update.' }, { status: 400 });
  }

  try {
    const policy = await saveTtsProviderPolicy(Number(body.expectedVersion), body.policy);
    return Response.json(
      { policy, source: 'policy' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof TtsConfigConflictError) {
      return Response.json(
        { error: error.message, current: error.current },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof Error) {
      return Response.json(
        { error: error.message },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json({ error: 'TTS configuration update failed.' }, { status: 500 });
  }
}
