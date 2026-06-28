import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { addVocabularyItem, getBookWithVocabulary } from '@/lib/actions/admin-actions';

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
  const data = getBookWithVocabulary(Number(id));
  if (!data) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json({ vocabulary: data.vocabulary });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await req.json();
  if (!body.word || typeof body.word !== 'string') {
    return Response.json({ error: 'word is required' }, { status: 400 });
  }
  const item = addVocabularyItem(Number(id), body);
  return Response.json({ item });
}
