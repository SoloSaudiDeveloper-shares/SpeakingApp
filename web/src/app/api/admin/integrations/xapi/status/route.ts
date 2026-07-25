import { requireAdmin } from '../_auth';
import { getXapiStatus } from '@/lib/integrations/xapi';

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json(getXapiStatus());
}
