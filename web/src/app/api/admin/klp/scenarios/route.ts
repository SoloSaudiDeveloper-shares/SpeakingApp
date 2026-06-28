import { generateKlpScenario, listGeneratedScenarios, publishGeneratedScenario } from '@/lib/actions/klp-actions';
import { requireKlpUser } from '../_auth';

export async function GET() {
  try {
    const auth = await requireKlpUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    return Response.json({ scenarios: listGeneratedScenarios(true) });
  } catch (error) {
    console.error('klp scenarios list error:', error);
    return Response.json({ error: 'KLP scenario list failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireKlpUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const body = await request.json();
    if (body.action === 'publish') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) return Response.json({ error: 'Invalid scenario id.' }, { status: 400 });
      return Response.json({ scenario: publishGeneratedScenario(id, body.publish !== false) });
    }
    const klpIds = Array.isArray(body.klpIds)
      ? body.klpIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : [];
    if (klpIds.length === 0) return Response.json({ error: 'Select at least one KLP.' }, { status: 400 });
    const scenario = await generateKlpScenario({
      klpIds,
      cefrLevel: typeof body.cefrLevel === 'string' ? body.cefrLevel : 'A1',
      progressionMode: typeof body.progressionMode === 'string' ? body.progressionMode : 'guided',
      createdByUserId: auth.id,
    });
    return Response.json({ scenario });
  } catch (error) {
    console.error('klp scenario generate error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'KLP scenario generation failed.' }, { status: 500 });
  }
}
