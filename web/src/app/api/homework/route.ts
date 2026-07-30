import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import {
  createHomework,
  getHomeworkForStudent,
  getHomeworkForTeacher,
} from '@/lib/actions/homework-actions';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    const { searchParams } = new URL(request.url);

    // studentId is set for students AND for admins/teachers previewing as a
    // learner — both should see the student homework view.
    if (user.studentId) {
      const className = searchParams.get('className') ?? '';
      const homework = await getHomeworkForStudent(user.studentId, className);
      return Response.json({ homework });
    }

    if (user.role === 'Teacher' || user.role === 'Admin') {
      const cycleId = searchParams.get('cycleId');
      if (!cycleId) return Response.json({ error: 'cycleId required.' }, { status: 400 });
      const homework = await getHomeworkForTeacher(Number(cycleId));
      return Response.json({ homework });
    }

    return Response.json({ error: 'Unauthorized.' }, { status: 403 });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Session expired.' }, { status: 401 });

    if (user.role !== 'Teacher' && user.role !== 'Admin') {
      return Response.json({ error: 'Only teachers can create homework.' }, { status: 403 });
    }

    const body = await request.json();
    const {
      cycleId,
      title,
      description,
      wordIds,
      taskTypes,
      dueDate,
      className,
      targetType,
      studentIds,
      klpIds,
      scenarioIds,
      source,
      status,
      pathConfig,
    } = body;

    if (!cycleId || !title || !dueDate) {
      return Response.json({ error: 'cycleId, title, and dueDate are required.' }, { status: 400 });
    }

    const homework = await createHomework({
      cycleId,
      createdByUserId: user.id,
      title,
      description,
      wordIds: wordIds ?? [],
      taskTypes: taskTypes ?? [],
      dueDate,
      className,
      targetType,
      studentIds: studentIds ?? [],
      klpIds: klpIds ?? [],
      scenarioIds: scenarioIds ?? [],
      source,
      status,
      pathConfig: pathConfig ?? null,
    });

    return Response.json({ homework }, { status: 201 });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
