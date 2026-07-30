import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function requireAdmin() {
  const token = (await cookies()).get('session-token')?.value;
  const user = token ? await getSessionFromToken(token) : null;
  if (!user) return { error: 'Not authenticated.', status: 401 as const };
  if (user.role !== 'Admin') return { error: 'Admin access required.', status: 403 as const };
  return user;
}
