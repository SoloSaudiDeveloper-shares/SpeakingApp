import { timingSafeEqual } from 'node:crypto';
import { drainXapiOutbox } from '@/lib/integrations/xapi';
import { getSecretStore } from '@/lib/secrets/secret-store';

function sameSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const expected = await getSecretStore().get('xapi_job_token');
  if (!expected || !supplied || !sameSecret(supplied, expected)) {
    return Response.json({ error: 'Not authorized.' }, { status: 401 });
  }
  return Response.json(await drainXapiOutbox({ includeFailed: true }));
}
