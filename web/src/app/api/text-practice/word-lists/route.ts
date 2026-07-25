import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getStudentWordLists, saveWordList, deleteWordList } from '@/lib/actions/text-practice-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const lists = await getStudentWordLists(user.studentId);
    return Response.json({ lists });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const body = await request.json();

    // Handle delete action
    if (body.action === 'delete' && body.id) {
      await deleteWordList(body.id);
      return Response.json({ success: true });
    }

    const { name, words } = body;

    if (!name || !words) {
      return Response.json({ error: 'Name and words are required.' }, { status: 400 });
    }

    const list = await saveWordList(user.studentId, name, words);
    return Response.json({ list });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
