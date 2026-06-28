import { register } from '@/lib/actions/auth-actions';

export async function POST(request: Request) {
  try {
    const { username, password, displayName, className } = await request.json();
    if (!username || !password || !displayName) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }

    const result = await register(username, password, displayName, className);
    if (!result) {
      return Response.json({ error: 'Username already exists.' }, { status: 409 });
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
