import { getTtsProviderPolicy, getCloudTtsReadiness } from '@/lib/speech/tts-config-server';
import { requireTtsUser } from '@/lib/speech/tts-route-auth';
import { getTtsUsage } from '@/lib/speech/tts-usage-server';

export async function GET() {
  const auth = await requireTtsUser();
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
