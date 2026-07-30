import { getKlpEvidenceReport } from '@/lib/actions/report-actions';
import { filtersFromUrl, requireReportUser } from '../_auth';

export async function GET(request: Request) {
  try {
    const auth = await requireReportUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    return Response.json(await getKlpEvidenceReport(filtersFromUrl(request)));
  } catch (error) {
    console.error('klp evidence report error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
