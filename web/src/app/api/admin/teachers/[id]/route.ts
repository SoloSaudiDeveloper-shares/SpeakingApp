import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import {
  deactivateTeacherAccount,
  resetTeacherPasswordAndActivate,
} from '@/lib/actions/admin-actions';
import { MIN_PASSWORD_LENGTH } from '@/lib/utils/password';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin') return { error: 'Admin only.', status: 403 } as const;
  return { user } as const;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: 'Invalid Teacher account.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as {
    action?: unknown;
    password?: unknown;
  } | null;

  try {
    if (body?.action === 'reset-password') {
      if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
        return Response.json(
          { error: `Temporary password must contain at least ${MIN_PASSWORD_LENGTH} characters.` },
          { status: 400 },
        );
      }
      const teacher = await resetTeacherPasswordAndActivate(id, body.password);
      return Response.json({ teacher });
    }
    if (body?.action === 'deactivate') {
      const teacher = await deactivateTeacherAccount(id);
      return Response.json({ teacher });
    }
    return Response.json({ error: 'Unsupported account action.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Teacher account not found.') {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: 'Account update failed.' }, { status: 500 });
  }
}
