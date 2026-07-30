import { requireAuthenticated } from '@/lib/auth/authorization';
import { getAppSettings, updateAppSetting } from '@/lib/actions/admin-actions';
import { API_KEY_KEYS, API_KEY_MASK } from '@/lib/ai/providers';
import { getSecretStore } from '@/lib/secrets/secret-store';
import { isSecretLikeSettingKey } from '@/lib/secrets/sensitive-setting';
import {
  settingWriteDecision,
  validateSettingValue,
} from '@/lib/security/settings-policy';

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
    const auth = await requireAuthenticated();
    if (!auth.ok) return auth.response;
    const { user } = auth;

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
    const auth = await requireAuthenticated({ roles: ['Admin', 'Teacher'] });
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const isAdmin = user.role === 'Admin';

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Settings payload must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Settings payload must be an object.' }, { status: 400 });
    }
    const settingsBody = body as Record<string, unknown>;
    const entries: Array<[string, unknown]> =
      typeof settingsBody.key === 'string' && settingsBody.value !== undefined
        ? [[settingsBody.key, settingsBody.value]]
        : Object.entries(settingsBody).filter(([key]) => key !== 'key' && key !== 'value');
    if (entries.length < 1 || entries.length > 50) {
      return Response.json({ error: 'Settings payload must contain between 1 and 50 entries.' }, { status: 400 });
    }

    // Validate the whole batch before writing any entry.
    for (const [key, value] of entries) {
      const decision = settingWriteDecision(user.role, key);
      if (!decision.allowed) {
        return Response.json({ error: decision.error }, { status: decision.status });
      }
      const valueError = validateSettingValue(key, value);
      if (valueError) return Response.json({ error: valueError }, { status: 400 });
      if (isSecretLikeSettingKey(key) && !SENSITIVE_KEYS.has(key)) {
        return Response.json(
          { error: 'Secret-like settings must use an approved encrypted secret field.' },
          { status: 400 },
        );
      }
      if (SENSITIVE_KEYS.has(key) && !isAdmin) {
        return Response.json({ error: 'Only admins can change API keys.' }, { status: 403 });
      }
    }

    for (const [key, value] of entries) {
      // Never save the mask back as the real value (user didn't change it)
      if (SENSITIVE_KEYS.has(key) && String(value) === API_KEY_MASK) continue;
      if (SENSITIVE_KEYS.has(key)) {
        const secret = String(value).trim();
        if (secret) await getSecretStore().set(key, secret);
        else await getSecretStore().clear(key);
      } else {
        await updateAppSetting(key, String(value));
      }
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
