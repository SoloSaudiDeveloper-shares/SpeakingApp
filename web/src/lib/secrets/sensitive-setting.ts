export const PROVIDER_SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  'groq_api_key',
  'grok_api_key',
  'openai_api_key',
  'azure_api_key',
  'azure_speech_key',
]);

const SECRET_NAME_PATTERN =
  /(?:^|_)(?:api_?key|secret|password|passwd|token|credential|private_?key|connection_?string)(?:_|$)/i;

export function isSecretLikeSettingKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  const normalized = key.trim().toLowerCase();
  return PROVIDER_SECRET_SETTING_KEYS.has(normalized) || SECRET_NAME_PATTERN.test(normalized);
}
