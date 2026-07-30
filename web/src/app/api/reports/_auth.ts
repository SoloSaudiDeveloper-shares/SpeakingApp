import { requireAuthenticated } from '@/lib/auth/authorization';

export async function requireReportUser() {
  const auth = await requireAuthenticated({ roles: ['Admin', 'Teacher'] });
  if (!auth.ok) {
    return {
      error: auth.response.status === 401 ? 'Not authenticated.' : 'Not authorized.',
      status: auth.response.status,
    } as const;
  }
  return { user: auth.user } as const;
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
