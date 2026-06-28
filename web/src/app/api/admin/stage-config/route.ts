import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import {
  getDefaultStageConfig,
  setDefaultStageConfig,
  listStudentsWithOverrides,
} from '@/lib/actions/stage-config-actions';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin') return { error: 'Admin only.', status: 403 } as const;
  return { user } as const;
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const defaults = getDefaultStageConfig();
  const overrides = listStudentsWithOverrides();
  return Response.json({ defaults, overrides });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json();
  setDefaultStageConfig(body);
  return Response.json({ ok: true, defaults: getDefaultStageConfig() });
}
