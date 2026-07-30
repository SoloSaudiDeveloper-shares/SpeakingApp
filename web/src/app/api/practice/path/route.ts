import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getLearnerPaths } from '@/lib/actions/path-actions';

async function load() {
  const token = (await cookies()).get('session-token')?.value;
  const user = token ? await getSessionFromToken(token) : null;
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  if (!user.studentId) return Response.json({ activePath: null, paths: [], legacyAssignments: [] });
  return Response.json(await getLearnerPaths(user.studentId));
}

export async function GET() { return load(); }
export async function POST() { return load(); }
