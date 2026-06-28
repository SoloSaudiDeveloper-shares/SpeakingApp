import { importKlpWorkbook, validateKlpWorkbook } from '@/lib/actions/klp-actions';
import { requireKlpUser } from '../_auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = await requireKlpUser(['Admin']);
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });

    const url = new URL(request.url);
    const commit = url.searchParams.get('commit') === 'true';
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'Upload an .xlsx file.' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (commit) {
      const imported = importKlpWorkbook({
        buffer,
        fileName: file.name,
        name: String(form.get('name') || 'ALC Index'),
        importedByUserId: auth.id,
      });
      return Response.json({ committed: true, ...imported });
    }
    const parsed = validateKlpWorkbook(buffer);
    return Response.json({ committed: false, summary: parsed.summary, warnings: parsed.warnings });
  } catch (error) {
    console.error('klp import error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'KLP import failed.' }, { status: 500 });
  }
}
