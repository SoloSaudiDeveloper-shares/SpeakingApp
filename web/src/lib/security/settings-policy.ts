const ADMIN_SETTING_KEYS = new Set([
  'active_ai_model',
  'active_stt_model',
  'active_tts_model',
  'ai_provider',
  'allow_student_model_choice',
  'azure_api_key',
  'azure_endpoint',
  'azure_model',
  'azure_speech_key',
  'azure_speech_region',
  'custom_practice_sets',
  'groq_api_key',
  'groq_model',
  'groq_stt_model',
  'grok_api_key',
  'grok_model',
  'klp_features_enabled',
  'mastery_threshold',
  'ollama_url',
  'openai_api_key',
  'openai_model',
  'pass_threshold',
  'stt_allow_offline_fallback',
  'stt_auto_stop',
  'stt_confidence_threshold',
  'stt_continuous',
  'stt_language',
  'stt_live_preview',
  'stt_noise_suppression',
  'stt_pause_warning_seconds',
  'stt_scored_pause_threshold_ms',
  'stt_silence_timeout',
  'tts_allow_student_choice',
  'tts_auto_play',
  'tts_default_rate',
  'tts_default_voice',
  'tts_default_volume',
  'tts_repeat_count',
  'tts_show_system_voice',
]);

/**
 * Teachers can change only content/assessment settings. Provider selection,
 * endpoints, credentials, models, voices, and organization defaults remain
 * administrator-only.
 */
const TEACHER_PEDAGOGICAL_SETTING_KEYS = new Set([
  'custom_practice_sets',
  'mastery_threshold',
  'pass_threshold',
  'stt_scored_pause_threshold_ms',
]);

export type SettingWriteDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403; error: string };

export function settingWriteDecision(
  role: string,
  key: unknown,
): SettingWriteDecision {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(key)) {
    return { allowed: false, status: 400, error: 'Invalid setting key.' };
  }
  if (!ADMIN_SETTING_KEYS.has(key)) {
    return { allowed: false, status: 400, error: 'This setting is not writable through the legacy settings API.' };
  }
  if (role === 'Admin') return { allowed: true };
  if (
    role === 'Teacher' &&
    TEACHER_PEDAGOGICAL_SETTING_KEYS.has(key)
  ) {
    return { allowed: true };
  }
  return { allowed: false, status: 403, error: 'This setting requires administrator access.' };
}

export function validateSettingValue(key: string, value: unknown): string | null {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return 'Setting values must be strings, numbers, or booleans.';
  }
  const text = String(value);
  const maxLength = key === 'custom_practice_sets' ? 250_000 : 4_096;
  if (text.length > maxLength) return 'Setting value is too large.';

  if (key === 'custom_practice_sets') {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return 'Custom practice sets must be a JSON array.';
    } catch {
      return 'Custom practice sets must contain valid JSON.';
    }
  }
  return null;
}

export function isKnownSettingKey(key: string): boolean {
  return ADMIN_SETTING_KEYS.has(key);
}
