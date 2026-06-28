import { requireIntegrationApiKey } from '@/lib/integrations/api-auth';
import { IntegrationError, type ExternalRole, getExternalSsoConfig, upsertExternalUser } from '@/lib/integrations/external-auth';

type RosterUser = {
  provider?: string;
  subject: string;
  role: ExternalRole;
  displayName: string;
  email?: string;
  studentNumber?: string;
  className?: string;
  classId?: string;
};

function normalizeUsers(body: unknown): RosterUser[] {
  if (Array.isArray(body)) return body as RosterUser[];
  if (body && typeof body === 'object') {
    const data = body as { users?: RosterUser[] };
    if (Array.isArray(data.users)) return data.users;
    return [body as RosterUser];
  }
  return [];
}

export async function POST(request: Request) {
  const auth = requireIntegrationApiKey(request);
  if (auth) return auth;

  try {
    const config = getExternalSsoConfig();
    const body = await request.json();
    const users = normalizeUsers(body);
    if (users.length === 0) {
      return Response.json({ error: 'No users provided.' }, { status: 400 });
    }

    const results = users.map((user) => {
      const local = upsertExternalUser({
        provider: user.provider ?? config.providerId,
        subject: user.subject,
        role: user.role,
        displayName: user.displayName,
        email: user.email,
        studentNumber: user.studentNumber,
        className: user.className,
        classId: user.classId,
      });
      return {
        provider: user.provider ?? config.providerId,
        subject: user.subject,
        localUserId: local.id,
        localStudentId: local.studentId,
        role: local.role,
      };
    });

    return Response.json({ ok: true, users: results });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('integration roster upsert error:', error);
    return Response.json({ error: 'Roster upsert failed.' }, { status: 500 });
  }
}
