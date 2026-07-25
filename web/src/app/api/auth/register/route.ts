import { register } from '@/lib/actions/auth-actions';
import { MIN_PASSWORD_LENGTH } from '@/lib/utils/password';

export async function POST(request: Request) {
  try {
    const { username, password, displayName, className } = await request.json();
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      typeof displayName !== 'string' ||
      !username.trim() ||
      !displayName.trim()
    ) {
      return Response.json({ error: 'All fields are required.' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return Response.json(
        { error: `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 },
      );
    }

    const result = await register(username.trim(), password, displayName.trim(), className);
    if (!result) {
      return Response.json({ error: 'Username already exists.' }, { status: 409 });
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
