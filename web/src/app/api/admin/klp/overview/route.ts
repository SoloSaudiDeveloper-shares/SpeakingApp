import { getKlpOverview, setKlpEnabled } from '@/lib/actions/klp-actions';
import { requireKlpUser } from '../_auth';

export async function GET() {
  try {
    const auth = await requireKlpUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    return Response.json(getKlpOverview());
  } catch (error) {
    console.error('klp overview error:', error);
    return Response.json({ error: 'KLP overview failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireKlpUser(['Admin']);
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const body = await request.json();
    setKlpEnabled(Boolean(body.enabled));
    return Response.json(getKlpOverview());
  } catch (error) {
    console.error('klp settings error:', error);
    return Response.json({ error: 'KLP settings update failed.' }, { status: 500 });
  }
}
