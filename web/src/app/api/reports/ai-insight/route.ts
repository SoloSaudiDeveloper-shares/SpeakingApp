import { callChat, getActiveProvider } from '@/lib/ai/providers';
import { getReportOverview, getStudentReport } from '@/lib/actions/report-actions';
import { requireReportUser } from '../_auth';

function safeParseInsight(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as { headline?: unknown; insights?: unknown; actions?: unknown };
    return {
      headline: typeof obj.headline === 'string' ? obj.headline : 'AI teacher insight',
      insights: Array.isArray(obj.insights) ? obj.insights.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
      actions: Array.isArray(obj.actions) ? obj.actions.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireReportUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const type = body?.type === 'student' ? 'student' : 'class';
    const studentId = Number(body?.studentId);
    const filters = {
      className: typeof body?.className === 'string' ? body.className : null,
      cefr: typeof body?.cefr === 'string' ? body.cefr : null,
      from: typeof body?.from === 'string' ? body.from : null,
      to: typeof body?.to === 'string' ? body.to : null,
      studentId: Number.isInteger(studentId) && studentId > 0 ? studentId : null,
    };

    const overview = getReportOverview(filters);
    const studentReport = type === 'student' && filters.studentId ? getStudentReport(filters.studentId, filters) : null;
    const fallback = studentReport?.deterministicInsights?.length
      ? studentReport.deterministicInsights
      : overview.deterministicInsights;

    const payload = type === 'student'
      ? {
          student: studentReport?.student,
          recentAttempts: studentReport?.attempts.slice(0, 12),
          weakWords: studentReport?.weakWords.slice(0, 8),
        }
      : {
          kpis: overview.kpis,
          classes: overview.classSummaries,
          studentsNeedingAttention: overview.students.filter((student) => student.needsAttention).slice(0, 10),
          weakWords: overview.topWeakWords.slice(0, 10),
        };

    try {
      const provider = getActiveProvider();
      const result = await callChat([
        {
          role: 'system',
          content: 'You are an expert English speaking teacher. Analyze the provided summarized metrics only. Do not invent scores. Return strict JSON with keys headline, insights, actions. insights and actions must be short string arrays.',
        },
        {
          role: 'user',
          content: JSON.stringify({ type, payload }),
        },
      ], { temperature: 0.3, maxTokens: 500 });
      const parsed = safeParseInsight(result.content);
      if (parsed) {
        return Response.json({
          aiAvailable: true,
          provider: result.provider,
          model: result.model,
          ...parsed,
        });
      }
      return Response.json({
        aiAvailable: true,
        provider: provider.provider,
        model: provider.model,
        headline: 'AI teacher insight',
        insights: [result.content.slice(0, 500)],
        actions: fallback.slice(0, 3),
      });
    } catch (error) {
      const provider = getActiveProvider();
      return Response.json({
        aiAvailable: false,
        provider: provider.provider,
        model: provider.model,
        warning: error instanceof Error ? error.message : 'AI unavailable',
        headline: 'Teacher insight',
        insights: fallback,
        actions: fallback.slice(0, 3),
      });
    }
  } catch (error) {
    console.error('reports ai insight error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
