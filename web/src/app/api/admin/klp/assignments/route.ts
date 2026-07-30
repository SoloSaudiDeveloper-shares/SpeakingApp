import { createHomework, getHomeworkForTeacher, type HomeworkTargetType } from '@/lib/actions/homework-actions';
import { requireKlpUser } from '../_auth';

function cleanNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
}

function cleanStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((id) => String(id).trim()).filter(Boolean)
    : [];
}

function isTargetType(value: unknown): value is HomeworkTargetType {
  return value === 'cycle' || value === 'class' || value === 'student';
}

export async function GET(request: Request) {
  try {
    const auth = await requireKlpUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const cycleId = Number(new URL(request.url).searchParams.get('cycleId') || 0);
    if (!Number.isInteger(cycleId) || cycleId < 1) {
      return Response.json({ error: 'cycleId is required.' }, { status: 400 });
    }
    return Response.json({
      assignments: (await getHomeworkForTeacher(cycleId)).filter((assignment) => assignment.source === 'klp'),
    });
  } catch (error) {
    console.error('klp assignments list error:', error);
    return Response.json({ error: 'KLP assignment list failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireKlpUser();
    if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const body = await request.json();
    const cycleId = Number(body.cycleId);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const dueDate = typeof body.dueDate === 'string' ? body.dueDate : '';
    const targetType = isTargetType(body.targetType) ? body.targetType : 'cycle';
    const studentIds = cleanNumberArray(body.studentIds);
    const klpIds = cleanNumberArray(body.klpIds);
    const scenarioIds = cleanStringArray(body.scenarioIds);
    const taskTypes = cleanStringArray(body.taskTypes);
    const controlledScenarioId = typeof body.pathConfig?.controlledScenarioId === 'string' ? body.pathConfig.controlledScenarioId.trim() : '';
    const openScenarioId = typeof body.pathConfig?.openScenarioId === 'string' ? body.pathConfig.openScenarioId.trim() : '';
    const className = typeof body.className === 'string' && body.className.trim() ? body.className.trim() : undefined;

    if (!Number.isInteger(cycleId) || cycleId < 1 || !title || !dueDate) {
      return Response.json({ error: 'cycleId, title, and dueDate are required.' }, { status: 400 });
    }
    if (targetType === 'class' && !className) {
      return Response.json({ error: 'className is required for class assignments.' }, { status: 400 });
    }
    if (targetType === 'student' && studentIds.length === 0) {
      return Response.json({ error: 'Select at least one student for student assignments.' }, { status: 400 });
    }
    if (klpIds.length === 0 && scenarioIds.length === 0) {
      return Response.json({ error: 'Assign at least one KLP or scenario.' }, { status: 400 });
    }

    const assignment = await createHomework({
      cycleId,
      createdByUserId: auth.id,
      title,
      description: typeof body.description === 'string' ? body.description : undefined,
      wordIds: cleanNumberArray(body.wordIds),
      taskTypes: taskTypes.length ? taskTypes : ['scenario'],
      dueDate,
      className,
      targetType,
      studentIds,
      klpIds,
      scenarioIds,
      source: 'klp',
      status: 'assigned',
      pathConfig: controlledScenarioId && openScenarioId ? {
        version: 1,
        targetWordIds: cleanNumberArray(body.pathConfig?.targetWordIds),
        controlledScenarioId,
        openScenarioId,
        textPracticeId: Number.isInteger(Number(body.pathConfig?.textPracticeId)) ? Number(body.pathConfig.textPracticeId) : null,
      } : null,
    });
    return Response.json({ assignment }, { status: 201 });
  } catch (error) {
    console.error('klp assignment create error:', error);
    return Response.json({ error: 'KLP assignment failed.' }, { status: 500 });
  }
}
