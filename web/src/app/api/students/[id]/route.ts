import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getStudent, updateStudent, deleteStudent } from '@/lib/actions/admin-actions';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin') return { error: 'Admin only.', status: 403 } as const;
  return { user } as const;
}

async function requireManager() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin' && user.role !== 'Teacher') return { error: 'Admin or teacher only.', status: 403 } as const;
  return { user } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManager();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const student = getStudent(Number(id));
  if (!student) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json({ student });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManager();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await req.json();
  const safeBody = auth.user.role === 'Teacher'
    ? { cefrBand: body.cefrBand, resetDiagnostic: body.resetDiagnostic }
    : body;
  const student = updateStudent(Number(id), safeBody);
  return Response.json({ student });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  deleteStudent(Number(id));
  return Response.json({ ok: true });
}
