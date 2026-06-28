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
    return Response.json(getExternalStudentSummary(decodeURIComponent(provider), decodeURIComponent(subject)));
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('integration student summary error:', error);
    return Response.json({ error: 'Student summary failed.' }, { status: 500 });
  }
}
