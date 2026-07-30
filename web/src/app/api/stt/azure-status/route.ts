import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getAzureSpeechTranscriptionConfig } from '@/lib/ai/providers';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user || user.role !== 'Admin') return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const { apiKey, region } = await getAzureSpeechTranscriptionConfig();
  if (!apiKey) {
    return Response.json({ ok: false, configured: false, error: 'No Azure Speech key configured.' }, { status: 503 });
  }

  try {
    const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Length': '0',
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return Response.json(
        { ok: false, configured: true, region, status: res.status, detail: detail.slice(0, 200) },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, configured: true, region });
  } catch (e) {
    return Response.json(
      { ok: false, configured: true, region, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
