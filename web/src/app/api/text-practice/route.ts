import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getStudentTexts, saveText } from '@/lib/actions/text-practice-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    if (!user.studentId) return Response.json({ error: 'Not a student.' }, { status: 403 });

    const texts = getStudentTexts(user.studentId);
    return Response.json({ texts });
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
    const { title, originalText, summary } = body;

    if (!title || !originalText) {
      return Response.json({ error: 'Title and text are required.' }, { status: 400 });
    }

    const text = saveText(user.studentId, title, originalText, summary);
    return Response.json({ text });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
