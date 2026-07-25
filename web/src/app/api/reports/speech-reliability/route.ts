import { getSpeechReliabilityReport } from '@/lib/actions/speech-reliability-actions';
import { filtersFromUrl, requireReportUser } from '../_auth';

export async function GET(request: Request) {
  try {
    const auth = await requireReportUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    return Response.json(await getSpeechReliabilityReport(filtersFromUrl(request)));
  } catch (error) {
    console.error('speech reliability report error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
