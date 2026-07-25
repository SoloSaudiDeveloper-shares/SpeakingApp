import { listKlpConcepts } from '@/lib/actions/klp-actions';
import { requireKlpUser } from '../_auth';

function param(url: URL, key: string) {
  const value = url.searchParams.get(key);
  return value && value.trim() ? value.trim() : null;
}

export async function GET(request: Request) {
  try {
    const auth = await requireKlpUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const url = new URL(request.url);
    return Response.json(await listKlpConcepts({
      q: param(url, 'q'),
      book: param(url, 'book'),
      lesson: param(url, 'lesson'),
      domain: param(url, 'domain'),
      supportStatus: param(url, 'supportStatus'),
      limit: Number(url.searchParams.get('limit') ?? 50),
      offset: Number(url.searchParams.get('offset') ?? 0),
    }));
  } catch (error) {
    console.error('klp concepts error:', error);
    return Response.json({ error: 'KLP browse failed.' }, { status: 500 });
  }
}
