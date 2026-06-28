import { getStudentReport } from '@/lib/actions/report-actions';
import { filtersFromUrl, requireReportUser } from '../../_auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireReportUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const { id } = await params;
    const studentId = Number(id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return Response.json({ error: 'Invalid student id.' }, { status: 400 });
    }
    return Response.json(getStudentReport(studentId, filtersFromUrl(request)));
  } catch (error) {
    console.error('reports student error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
