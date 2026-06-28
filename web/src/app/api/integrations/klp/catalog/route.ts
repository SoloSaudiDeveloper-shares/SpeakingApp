import { getKlpCatalogExport, getKlpOverview } from '@/lib/actions/klp-actions';
import { requireIntegrationApiKey } from '@/lib/integrations/api-auth';

export async function GET(request: Request) {
  const auth = requireIntegrationApiKey(request);
  if (auth) return auth;

  try {
    return Response.json({
      generatedAt: new Date().toISOString(),
      overview: getKlpOverview(),
      catalog: getKlpCatalogExport(),
    });
  } catch (error) {
    console.error('integration klp catalog error:', error);
    return Response.json({ error: 'KLP catalog export failed.' }, { status: 500 });
  }
}
