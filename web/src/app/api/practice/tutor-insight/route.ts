import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getStudentTutorInsight } from '@/lib/actions/report-actions';
import { callChat, getActiveProvider } from '@/lib/ai/providers';
import {
  consumeCloudAiBudgetIfNeeded,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';

function parseTutorJson(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as { headline?: unknown; strengths?: unknown; focus?: unknown; actions?: unknown };
    return {
      headline: typeof obj.headline === 'string' ? obj.headline : 'Your AI tutor insight',
      strengths: Array.isArray(obj.strengths) ? obj.strengths.filter((item): item is string => typeof item === 'string').slice(0, 3) : [],
      focus: Array.isArray(obj.focus) ? obj.focus.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
      actions: Array.isArray(obj.actions)
        ? obj.actions.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const action = item as { title?: unknown; href?: unknown; reason?: unknown };
            return typeof action.title === 'string' && typeof action.href === 'string' && typeof action.reason === 'string'
              ? [{ title: action.title, href: action.href, reason: action.reason }]
              : [];
          }).slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user?.studentId) return Response.json({ error: 'Student only.' }, { status: 403 });

    const summary = await getStudentTutorInsight(user.studentId);
    if (!summary) return Response.json({ error: 'Student was not found.' }, { status: 404 });

    try {
      await consumeCloudAiBudgetIfNeeded(user.id);
      const result = await callChat([
        {
          role: 'system',
          content: 'You are a concise English speaking tutor for Arabic-speaking learners. Use only the metrics provided. Return strict JSON with headline, strengths, focus, actions. actions must be objects with title, href, reason and must use the supplied hrefs only.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            metrics: summary.metrics,
            deterministic: summary.deterministic,
            allowedActions: summary.deterministic.actions,
          }),
        },
      ], { temperature: 0.3, maxTokens: 450 });
      const parsed = parseTutorJson(result.content);
      if (parsed) {
        return Response.json({
          aiAvailable: true,
          provider: result.provider,
          model: result.model,
          insight: {
            ...summary.deterministic,
            ...parsed,
            actions: parsed.actions.length ? parsed.actions : summary.deterministic.actions,
          },
        });
      }
      return Response.json({
        aiAvailable: true,
        provider: result.provider,
        model: result.model,
        insight: summary.deterministic,
        raw: result.content.slice(0, 500),
      });
    } catch (error) {
      const budgetResponse = resourceBudgetResponse(error);
      if (budgetResponse) return budgetResponse;
      const provider = await getActiveProvider();
      return Response.json({
        aiAvailable: false,
        provider: provider.provider,
        model: provider.model,
        warning: error instanceof Error ? error.message : 'AI unavailable',
        insight: summary.deterministic,
      });
    }
  } catch (error) {
    console.error('student tutor insight error:', error);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
