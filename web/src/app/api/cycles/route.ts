import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCycles, createCycle, enrollStudents } from '@/lib/actions/admin-actions';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher'))
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    return Response.json({ cycles: getCycles() });
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
    const cycle = createCycle(body);

    if (body.studentIds?.length) {
      enrollStudents(cycle.id, body.studentIds);
    }

    return Response.json({ cycle });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
