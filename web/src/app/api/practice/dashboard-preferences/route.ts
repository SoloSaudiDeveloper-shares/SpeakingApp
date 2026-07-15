import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { db } from '@/lib/db';
import { dashboardWidgets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const DEFAULTS = { version: 1, activeTab: 'practice' as const, collapsedSections: [] as string[] };
const ALLOWED_SECTIONS = new Set([
  'continue-lesson', 'lesson-path', 'secondary-practice', 'speaking-profile',
  'ai-coach', 'stats', 'mastery', 'recent-attempts', 'streaks', 'leaderboard',
]);

async function currentUser() {
  const token = (await cookies()).get('session-token')?.value;
  return token ? getSessionFromToken(token) : null;
}

function parseCollapsed(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter((id) => ALLOWED_SECTIONS.has(id)) : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const row = db.select().from(dashboardWidgets).where(eq(dashboardWidgets.userId, user.id)).get();
  if (!row) return Response.json(DEFAULTS);
  return Response.json({
    version: row.version || 1,
    activeTab: row.activeTab === 'progress' ? 'progress' : 'practice',
    collapsedSections: parseCollapsed(row.collapsedSectionsJson),
  });
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const existing = db.select().from(dashboardWidgets).where(eq(dashboardWidgets.userId, user.id)).get();
  const activeTab = body.activeTab === 'progress' ? 'progress' : 'practice';
  const collapsedSections = Array.isArray(body.collapsedSections)
    ? body.collapsedSections.map(String).filter((id: string) => ALLOWED_SECTIONS.has(id))
    : [];
  const now = new Date().toISOString();
  const values = {
    version: Math.max(1, (existing?.version ?? 0) + 1),
    activeTab,
    collapsedSectionsJson: JSON.stringify([...new Set(collapsedSections)]),
    updatedAt: now,
    widgetConfig: '[]',
  };
  if (existing) db.update(dashboardWidgets).set(values).where(eq(dashboardWidgets.id, existing.id)).run();
  else db.insert(dashboardWidgets).values({ userId: user.id, ...values }).run();
  return Response.json({ version: values.version, activeTab, collapsedSections });
}
