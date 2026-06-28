import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function requireReportUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin' && user.role !== 'Teacher') {
    return { error: 'Not authorized.', status: 403 } as const;
  }
  return { user } as const;
}

export function filtersFromUrl(request: Request) {
  const url = new URL(request.url);
  const studentIdRaw = url.searchParams.get('studentId');
  const studentId = studentIdRaw ? Number(studentIdRaw) : null;
  return {
    className: url.searchParams.get('class') || null,
    cefr: url.searchParams.get('cefr') || null,
    from: url.searchParams.get('from') || null,
    to: url.searchParams.get('to') || null,
    studentId: Number.isFinite(studentId) && studentId ? studentId : null,
  };
}
