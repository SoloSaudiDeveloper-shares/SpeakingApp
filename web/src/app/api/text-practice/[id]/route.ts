import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getTextById, deleteText } from '@/lib/actions/text-practice-actions';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const { id } = await params;
    const textId = parseInt(id, 10);
    if (isNaN(textId)) return Response.json({ error: 'Invalid ID.' }, { status: 400 });

    const text = getTextById(textId);
    if (!text) return Response.json({ error: 'Text not found.' }, { status: 404 });

    return Response.json({ text });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const { id } = await params;
    const textId = parseInt(id, 10);
    if (isNaN(textId)) return Response.json({ error: 'Invalid ID.' }, { status: 400 });

    deleteText(textId);
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
