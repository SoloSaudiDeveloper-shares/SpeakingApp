import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getCycleWithEnrollments, updateCycle, deleteCycle, enrollStudents, unenrollStudent } from '@/lib/actions/admin-actions';

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
  const cycle = await getCycleWithEnrollments(Number(id));
  if (!cycle) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json({ cycle });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await req.json();

  // Allow either updating fields or modifying enrollments
  if (Array.isArray(body.enrollIds)) {
    await enrollStudents(Number(id), body.enrollIds);
  }
  if (typeof body.unenrollId === 'number') {
    await unenrollStudent(Number(id), body.unenrollId);
  }
  if (body.startDate || body.endDate || body.bookId !== undefined || body.teacherNotes !== undefined) {
    await updateCycle(Number(id), body);
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  await deleteCycle(Number(id));
  return Response.json({ ok: true });
}
