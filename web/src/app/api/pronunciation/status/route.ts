import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getPronunciationConfig } from '@/lib/ai/providers';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { apiKey, region } = getPronunciationConfig();
  return Response.json({
    configured: !!apiKey,
    provider: 'azure',
    region: apiKey ? region : null,
  });
}
