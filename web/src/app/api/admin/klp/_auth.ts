import { cookies } from 'next/headers';
import { getSessionFromToken, type SessionUser } from '@/lib/actions/auth-actions';

export async function requireKlpUser(roles: string[] = ['Admin', 'Teacher']): Promise<SessionUser | { error: string; status: number }> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 };
  const user = await getSessionFromToken(token);
  if (!user || !roles.includes(user.role)) return { error: 'Not authorized.', status: 403 };
  return user;
}
