import { getKlpResults } from '@/lib/actions/klp-actions';
import { requireIntegrationApiKey } from '@/lib/integrations/api-auth';
import { getExternalStudentSummary, IntegrationError } from '@/lib/integrations/external-auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string; subject: string }> },
) {
  const auth = requireIntegrationApiKey(request);
  if (auth) return auth;

  try {
    const { provider, subject } = await params;
    const summary = await getExternalStudentSummary(decodeURIComponent(provider), decodeURIComponent(subject));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || 100);
    return Response.json({
      generatedAt: new Date().toISOString(),
      provider: summary.provider,
      subject: summary.subject,
      localStudentId: summary.localStudentId,
      results: getKlpResults({ studentId: summary.localStudentId, limit }),
    });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('integration student klp results error:', error);
    return Response.json({ error: 'Student KLP results export failed.' }, { status: 500 });
  }
}
