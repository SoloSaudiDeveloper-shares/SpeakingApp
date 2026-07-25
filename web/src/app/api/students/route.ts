import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getStudents, createStudent } from '@/lib/actions/admin-actions';
import { MIN_PASSWORD_LENGTH } from '@/lib/utils/password';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher'))
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    return Response.json({ students: await getStudents() });
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
    if (!user || user.role !== 'Admin')
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    const body = await request.json();
    if (
      typeof body.uniqueNumber !== 'string' ||
      typeof body.fullName !== 'string' ||
      !body.uniqueNumber.trim() ||
      !body.fullName.trim()
    ) {
      return Response.json({ error: 'Student number and full name are required.' }, { status: 400 });
    }
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
      return Response.json(
        { error: `A temporary password of at least ${MIN_PASSWORD_LENGTH} characters is required.` },
        { status: 400 },
      );
    }
    body.uniqueNumber = body.uniqueNumber.trim();
    body.fullName = body.fullName.trim();
    const student = await createStudent(body);
    return Response.json({ student });
  } catch (error) {
    if (error instanceof Error && error.message.includes('password')) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
