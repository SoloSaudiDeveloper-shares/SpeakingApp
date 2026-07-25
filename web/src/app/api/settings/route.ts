import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { getAppSettings, updateAppSetting } from '@/lib/actions/admin-actions';
import { API_KEY_KEYS, API_KEY_MASK } from '@/lib/ai/providers';
import { getSecretStore } from '@/lib/secrets/secret-store';
import { isSecretLikeSettingKey } from '@/lib/secrets/sensitive-setting';

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

    const settings = await getAppSettings();

    // Non-admins never even see the existence of API keys
    const isAdmin = user.role === 'Admin';

    const settingsObj: Record<string, string> = {};
    const filteredSettings: typeof settings = [];
    for (const s of settings) {
      if (isSecretLikeSettingKey(s.key)) continue;
      const v = redact(s.value, s.key);
      settingsObj[s.key] = v;
      filteredSettings.push({ ...s, value: v });
    }
    if (isAdmin) {
      const secretStore = getSecretStore();
      for (const key of SENSITIVE_KEYS) {
        const value = await secretStore.configured(key) ? API_KEY_MASK : '';
        settingsObj[key] = value;
        filteredSettings.push({ key, value });
      }
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
      if (isSecretLikeSettingKey(body.key) && !SENSITIVE_KEYS.has(body.key)) {
        return Response.json(
          { error: 'Secret-like settings must use an approved encrypted secret field.' },
          { status: 400 },
        );
      }
      if (SENSITIVE_KEYS.has(body.key) && !isAdmin) {
        return Response.json({ error: 'Only admins can change API keys.' }, { status: 403 });
      }
      // Never save the mask back as the real value (user didn't change it)
      if (SENSITIVE_KEYS.has(body.key) && String(body.value) === API_KEY_MASK) {
        return Response.json({ success: true, noop: true });
      }
      if (SENSITIVE_KEYS.has(body.key)) {
        const value = String(body.value).trim();
        if (value) await getSecretStore().set(body.key, value);
        else await getSecretStore().clear(body.key);
      } else {
        await updateAppSetting(body.key, String(body.value));
      }
    } else {
      const entries = Object.entries(body).filter(([key]) => key !== 'key' && key !== 'value');
      for (const [key] of entries) {
        if (SENSITIVE_KEYS.has(key) && !isAdmin) {
          return Response.json({ error: 'Only admins can change API keys.' }, { status: 403 });
        }
        if (isSecretLikeSettingKey(key) && !SENSITIVE_KEYS.has(key)) {
          return Response.json(
            { error: 'Secret-like settings must use an approved encrypted secret field.' },
            { status: 400 },
          );
        }
      }
      for (const [key, value] of entries) {
        if (SENSITIVE_KEYS.has(key) && String(value) === API_KEY_MASK) continue; // skip mask
        if (SENSITIVE_KEYS.has(key)) {
          const secret = String(value).trim();
          if (secret) await getSecretStore().set(key, secret);
          else await getSecretStore().clear(key);
        } else {
          await updateAppSetting(key, String(value));
        }
      }
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
