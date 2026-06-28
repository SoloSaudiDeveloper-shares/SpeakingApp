import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user || user.role !== 'Admin')
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    const res = await fetch('http://localhost:11434/api/tags');
    if (!res.ok) return Response.json({ models: [] });
    const data = await res.json();
    return Response.json({ models: data.models ?? [] });
  } catch {
    return Response.json({ models: [] });
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user || user.role !== 'Admin')
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    const body = await request.json();

    if (body.action === 'pull') {
      const res = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: body.name, stream: false }),
      });
      if (res.ok) return Response.json({ success: true });
      return Response.json({ error: 'Pull failed.' }, { status: 500 });
    }

    if (body.action === 'delete') {
      const res = await fetch('http://localhost:11434/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: body.name }),
      });
      if (res.ok) return Response.json({ success: true });
      return Response.json({ error: 'Delete failed.' }, { status: 500 });
    }

    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
