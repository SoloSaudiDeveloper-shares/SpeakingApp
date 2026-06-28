import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getBookWithVocabulary, updateBook, deleteBook } from '@/lib/actions/admin-actions';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin' && user.role !== 'Teacher') {
    return { error: 'Admin/Teacher only.', status: 403 } as const;
  }
  return { user } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const data = getBookWithVocabulary(Number(id));
  if (!data) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json(data);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.user.role !== 'Admin') return Response.json({ error: 'Admin only.' }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  updateBook(Number(id), body);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.user.role !== 'Admin') return Response.json({ error: 'Admin only.' }, { status: 403 });
  const { id } = await params;
  try {
    deleteBook(Number(id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Delete failed' }, { status: 400 });
  }
}
