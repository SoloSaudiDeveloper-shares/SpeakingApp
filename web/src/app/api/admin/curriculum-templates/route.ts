import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { CURRICULUM_TEMPLATES, getTemplate } from '@/lib/curriculum/templates';
import { importBook, createCycle } from '@/lib/actions/admin-actions';
import { setDefaultStageConfig } from '@/lib/actions/stage-config-actions';

async function requireTeacher() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return { error: 'Not authenticated.', status: 401 } as const;
  const user = await getSessionFromToken(token);
  if (!user) return { error: 'Session expired.', status: 401 } as const;
  if (user.role !== 'Admin' && user.role !== 'Teacher') return { error: 'Not authorized.', status: 403 } as const;
  return { user } as const;
}

export async function GET() {
  const auth = await requireTeacher();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });
  // Return templates without the full word list (keep payload light)
  return Response.json({
    templates: CURRICULUM_TEMPLATES.map((t) => ({
      id: t.id, title: t.title, description: t.description, cefrLevel: t.cefrLevel,
      focus: t.focus, wordCount: t.words.length, suggestedScenarios: t.suggestedScenarios,
      stageSequence: t.stageSequence, unlockMode: t.unlockMode,
    })),
  });
}

/** POST { templateId, startDate?, endDate?, applyStageConfig? } → provisions a book + cycle. */
export async function POST(request: Request) {
  const auth = await requireTeacher();
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const template = getTemplate(body.templateId);
  if (!template) return Response.json({ error: 'Unknown template.' }, { status: 400 });

  // 1. Create the book (auto-generates ListenRepeat tasks)
  const book = await importBook({
    title: template.title,
    cefrLevel: template.cefrLevel,
    words: template.words,
  });

  // 2. Create a 2-week cycle for it
  const start = body.startDate ?? new Date().toISOString().slice(0, 10);
  const end = body.endDate ?? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const cycle = await createCycle({
    startDate: start,
    endDate: end,
    bookId: book.id,
    teacherNotes: `Provisioned from template: ${template.title}`,
  });

  // 3. Optionally apply the template's suggested stage config as the default
  if (body.applyStageConfig !== false) {
    await setDefaultStageConfig({
      sequence: template.stageSequence as never,
      unlockMode: template.unlockMode,
    });
  }

  return Response.json({
    ok: true,
    book: { id: book.id, title: book.title },
    cycle: { id: cycle.id, startDate: cycle.startDate, endDate: cycle.endDate },
    suggestedScenarios: template.suggestedScenarios,
  });
}
