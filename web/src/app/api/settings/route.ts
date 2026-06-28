import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getAppSettings, updateAppSetting } from '@/lib/actions/admin-actions';
import { API_KEY_KEYS, API_KEY_MASK } from '@/lib/ai/providers';

/**
 * Sensitive settings (API keys, etc.) that should never be sent back to the
 * client after being saved. The settings UI shows the mask "••••••••" and only
 * saves a new value when the field is changed AND non-empty.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = API_KEY_KEYS;

function redact(value: string, key: string): string {
  if (!SENSITIVE_KEYS.has(key)) return value;
  if (!value) return '';
  return API_KEY_MASK;
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });

    const settings = getAppSettings();

    // Non-admins never even see the existence of API keys
    const isAdmin = user.role === 'Admin';

    const settingsObj: Record<string, string> = {};
    const filteredSettings: typeof settings = [];
    for (const s of settings) {
      if (SENSITIVE_KEYS.has(s.key) && !isAdmin) continue;
      const v = redact(s.value, s.key);
      settingsObj[s.key] = v;
      filteredSettings.push({ ...s, value: v });
    }
    return Response.json({ settings: filteredSettings, ...settingsObj });
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
    if (!user || (user.role !== 'Admin' && user.role !== 'Teacher'))
      return Response.json({ error: 'Not authorized.' }, { status: 403 });

    // Non-admins cannot write API keys
    const isAdmin = user.role === 'Admin';

    const body = await request.json();
    if (body.key && body.value !== undefined) {
      if (SENSITIVE_KEYS.has(body.key) && !isAdmin) {
        return Response.json({ error: 'Only admins can change API keys.' }, { status: 403 });
      }
      // Never save the mask back as the real value (user didn't change it)
      if (SENSITIVE_KEYS.has(body.key) && String(body.value) === API_KEY_MASK) {
        return Response.json({ success: true, noop: true });
      }
      updateAppSetting(body.key, String(body.value));
    } else {
      for (const [key, value] of Object.entries(body)) {
        if (key === 'key' || key === 'value') continue;
        if (SENSITIVE_KEYS.has(key) && !isAdmin) continue; // silently skip
        if (SENSITIVE_KEYS.has(key) && String(value) === API_KEY_MASK) continue; // skip mask
        updateAppSetting(key, String(value));
      }
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
