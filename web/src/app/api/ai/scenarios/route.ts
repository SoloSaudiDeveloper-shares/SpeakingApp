import { SCENARIOS } from '@/lib/ai/scenarios';
import { generatedScenarioAsScenario, listGeneratedScenarios } from '@/lib/actions/klp-actions';
import { getAssignedKlpScenarioIdsForStudent } from '@/lib/actions/homework-actions';
import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

export async function GET() {
  try {
    const generated = listGeneratedScenarios(false).map(generatedScenarioAsScenario);
    const all = [...SCENARIOS, ...generated];
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    const user = token ? await getSessionFromToken(token) : null;
    const assignedScenarioIds = user?.studentId ? getAssignedKlpScenarioIdsForStudent(user.studentId) : [];
    const assignedSet = new Set(assignedScenarioIds);
    const scenarios = assignedSet.size
      ? [...all].sort((a, b) => Number(assignedSet.has(b.id)) - Number(assignedSet.has(a.id)))
      : all;
    return Response.json({ scenarios, assignedScenarioIds });
  } catch (error) {
    console.error('ai scenarios error:', error);
    return Response.json({ scenarios: SCENARIOS, warning: 'Generated scenarios unavailable.' });
  }
}
