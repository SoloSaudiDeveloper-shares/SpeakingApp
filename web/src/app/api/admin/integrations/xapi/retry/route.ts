import { after } from 'next/server';
import { requireAdmin } from '../_auth';
import { drainXapiOutbox, retryXapiFailures } from '@/lib/integrations/xapi';

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const statementIds = Array.isArray(body.statementIds) ? body.statementIds.map(String).filter(Boolean) : undefined;
  const queued = await retryXapiFailures(statementIds);
  after(() => drainXapiOutbox({ includeFailed: true }));
  return Response.json({ queued });
}
