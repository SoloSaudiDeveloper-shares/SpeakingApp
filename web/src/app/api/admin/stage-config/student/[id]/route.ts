import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import {
  getStudentStageOverride,
  setStudentStageOverride,
  clearStudentStageOverride,
  getDefaultStageConfig,
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const override = getStudentStageOverride(Number(id));
  return Response.json({
    override,
    defaults: getDefaultStageConfig(),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await req.json();
  setStudentStageOverride(Number(id), body);
  return Response.json({ ok: true, override: getStudentStageOverride(Number(id)) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  clearStudentStageOverride(Number(id));
  return Response.json({ ok: true });
}
