import { getTtsProviderPolicy } from '@/lib/speech/tts-config-server';
import { requireTtsAdmin } from '@/lib/speech/tts-route-auth';
import { currentTtsPeriod, getTtsUsage } from '@/lib/speech/tts-usage-server';

export async function GET() {
  const auth = await requireTtsAdmin();
  if ('response' in auth) return auth.response;
  try {
    const { policy } = await getTtsProviderPolicy();
    const usage = await getTtsUsage(policy);
    return Response.json(
      { periodMonth: currentTtsPeriod(), usage },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return Response.json({ error: 'TTS usage is unavailable.' }, { status: 500 });
  }
}
