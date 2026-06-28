import { getExternalSsoConfig } from '@/lib/integrations/external-auth';
import { requireIntegrationApiKey } from '@/lib/integrations/api-auth';

export async function GET(request: Request) {
  const auth = requireIntegrationApiKey(request);
  if (auth) return auth;

  const sso = getExternalSsoConfig();
  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    sso: {
      enabled: sso.enabled,
      providerId: sso.providerId,
      issuerConfigured: !!sso.issuer,
      audienceConfigured: !!sso.audience,
      sharedSecretConfigured: !!sso.sharedSecret,
      adminLaunchAllowed: sso.allowAdmin,
    },
    integrationApi: {
      configured: !!process.env.INTEGRATION_API_KEY,
    },
  });
}
