import { getKlpResults } from '@/lib/actions/klp-actions';
import { requireIntegrationApiKey } from '@/lib/integrations/api-auth';

export async function GET(request: Request) {
  const auth = requireIntegrationApiKey(request);
  if (auth) return auth;

  try {
    const url = new URL(request.url);
    const studentId = Number(url.searchParams.get('studentId') || 0) || undefined;
    const limit = Number(url.searchParams.get('limit') || 100);
    return Response.json({
      generatedAt: new Date().toISOString(),
      results: getKlpResults({ studentId, limit }),
    });
  } catch (error) {
    console.error('integration klp results error:', error);
    return Response.json({ error: 'KLP results export failed.' }, { status: 500 });
  }
}
