/**
 * AI provider abstraction.
 *
 * Providers: Ollama (local, default), Groq (cloud, free), Grok (xAI), OpenAI.
 *
 * Settings live in app_settings:
 *   - ai_provider: "ollama" | "groq" | "grok" | "openai"
 *
 * Ollama:
 *   - ollama_url
 *   - active_ai_model           (e.g. "llama3.1:8b")
 *
 * Groq (groq.com — fast inference, free tier):
 *   - groq_api_key              (starts with "gsk_")
 *   - groq_model                (e.g. "llama-3.3-70b-versatile")
 *
 * Grok (xAI / x.ai):
 *   - grok_api_key              (starts with "xai-")
 *   - grok_model                (e.g. "grok-2-latest")
 *
 * OpenAI:
 *   - openai_api_key
 *   - openai_model              (e.g. "gpt-4o-mini")
 *
 * Azure / Microsoft Foundry (OpenAI-compatible v1 API):
 *   - azure_endpoint            (e.g. "https://my-resource.openai.azure.com")
 *   - azure_api_key             (uses the `api-key` header, not Bearer)
 *   - azure_model               (the DEPLOYMENT name, e.g. "gpt-4o-mini")
 *   - azure_api_version         (legacy only; /openai/v1 endpoints do not allow it)
 *
 * API keys are stored in plain text in the SQLite DB. They're admin-only via
 * the settings POST endpoint and never sent back in the GET response (they're
 * redacted as a fixed mask "••••••••").
 */

import { db } from '../db';
import { appSettings } from '../db/schema';
import { eq } from 'drizzle-orm';

export type ProviderId = 'ollama' | 'groq' | 'grok' | 'openai' | 'azure';

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey: string | null;
  baseUrl: string;
}

const DEFAULTS: Record<ProviderId, { baseUrl: string; model: string }> = {
  ollama: { baseUrl: 'http://localhost:11434',         model: 'llama3.1:8b' },
  groq:   { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  grok:   { baseUrl: 'https://api.x.ai/v1',            model: 'grok-2-latest' },
  openai: { baseUrl: 'https://api.openai.com/v1',      model: 'gpt-4o-mini' },
  azure:  { baseUrl: '',                               model: 'gpt-4o-mini' }, // endpoint is per-install
};

/**
 * Normalize an Azure / Foundry endpoint to its OpenAI-compatible v1 base, so we
 * accept whatever the admin pastes: a bare resource endpoint, one already ending
 * in /openai or /openai/v1, or even a full .../chat/completions or /responses URL.
 *   https://res.openai.azure.com           → https://res.openai.azure.com/openai/v1
 *   https://res.services.ai.azure.com/openai/v1 → unchanged
 */
function azureV1Base(endpoint: string): string {
  let b = (endpoint || '').trim().replace(/\/+$/, '');
  b = b.replace(/\/chat\/completions.*$/i, '');      // strip a pasted full URL back to base
  b = b.replace(/\/responses.*$/i, '');               // strip a pasted Foundry Responses URL
  if (/\/openai\/v1$/i.test(b)) return b;            // already the v1 surface
  // Any other /openai path (/openai, /openai/deployments/x) → normalize to v1.
  if (/\/openai(\/.*)?$/i.test(b)) return b.replace(/\/openai(\/.*)?$/i, '/openai/v1');
  return `${b}/openai/v1`;                            // bare resource endpoint
}

function isReasoningChatModel(model: string): boolean {
  return /^(o1|o3|o4)(?:-|$)/i.test(model.trim());
}

function chatCompletionsBody(
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: { temperature?: number; maxTokens?: number },
) {
  const body: {
    model: string;
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    stream: false;
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
  } = { model, messages, stream: false };

  if (isReasoningChatModel(model)) {
    if (options.maxTokens) body.max_completion_tokens = options.maxTokens;
    return body;
  }

  body.temperature = options.temperature ?? 0.7;
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  return body;
}

/** API keys are sensitive; we should never reveal them after they're stored. */
export const API_KEY_KEYS: ReadonlySet<string> = new Set([
  'groq_api_key',
  'grok_api_key',
  'openai_api_key',
  'azure_api_key',
  'azure_speech_key',
]);

export const API_KEY_MASK = '••••••••';

function getSetting(key: string): string | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

/** Look up the configured provider + model + key for the current installation. */
export function getActiveProvider(): ProviderConfig {
  const provider = (getSetting('ai_provider') as ProviderId | null) ?? 'ollama';

  switch (provider) {
    case 'groq':
      return {
        provider: 'groq',
        model: getSetting('groq_model') ?? DEFAULTS.groq.model,
        apiKey: getSetting('groq_api_key'),
        baseUrl: DEFAULTS.groq.baseUrl,
      };
    case 'grok':
      return {
        provider: 'grok',
        model: getSetting('grok_model') ?? DEFAULTS.grok.model,
        apiKey: getSetting('grok_api_key'),
        baseUrl: DEFAULTS.grok.baseUrl,
      };
    case 'openai':
      return {
        provider: 'openai',
        model: getSetting('openai_model') ?? DEFAULTS.openai.model,
        apiKey: getSetting('openai_api_key'),
        baseUrl: DEFAULTS.openai.baseUrl,
      };
    case 'azure':
      return {
        provider: 'azure',
        model: getSetting('azure_model') ?? DEFAULTS.azure.model, // deployment name
        apiKey: getSetting('azure_api_key'),
        baseUrl: getSetting('azure_endpoint') ?? '',
      };
    case 'ollama':
    default:
      return {
        provider: 'ollama',
        model: getSetting('active_ai_model') ?? DEFAULTS.ollama.model,
        apiKey: null,
        baseUrl: getSetting('ollama_url') ?? DEFAULTS.ollama.baseUrl,
      };
  }
}

/**
 * Call the chat endpoint of the configured provider.
 * Returns a unified shape: { content, raw }
 *
 * `messages` is OpenAI-style: [{ role: "system"|"user"|"assistant", content: "…" }]
 */
/**
 * Config for cloud speech-to-text. We use Groq's hosted Whisper
 * (whisper-large-v3-turbo) regardless of which chat provider is active, since
 * the Groq key is the one the app ships with. apiKey is null when unset, so
 * callers fall back to the bundled offline Whisper.
 */
export function getTranscriptionConfig(): { apiKey: string | null; baseUrl: string; model: string } {
  return {
    apiKey: getSetting('groq_api_key'),
    baseUrl: DEFAULTS.groq.baseUrl,
    model: getSetting('groq_stt_model') ?? 'whisper-large-v3-turbo',
  };
}

/**
 * Config for Azure AI Speech — Pronunciation Assessment (phoneme-level accuracy,
 * fluency, completeness, prosody). Returns key=null when unset, so the app
 * gracefully falls back to transcript-based scoring.
 */
export function getPronunciationConfig(): { apiKey: string | null; region: string } {
  return {
    apiKey: getSetting('azure_speech_key'),
    region: getSetting('azure_speech_region') ?? 'eastus',
  };
}

export function getAzureSpeechTranscriptionConfig(): { apiKey: string | null; region: string; language: string } {
  return {
    apiKey: getSetting('azure_speech_key'),
    region: getSetting('azure_speech_region') ?? 'eastus',
    language: getSetting('stt_language') ?? 'en-US',
  };
}

export async function callChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: { temperature?: number; maxTokens?: number; modelOverride?: string } = {},
): Promise<{ content: string; provider: ProviderId; model: string }> {
  const cfg = getActiveProvider();
  const model = options.modelOverride ?? cfg.model;

  if (cfg.provider === 'ollama') {
    const res = await fetch(`${cfg.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    return {
      content: data.message?.content ?? data.response ?? '',
      provider: 'ollama',
      model,
    };
  }

  // Azure / Microsoft Foundry: OpenAI-compatible body, but a different URL and
  // the `api-key` header instead of `Authorization: Bearer`.
  if (cfg.provider === 'azure') {
    if (!cfg.baseUrl) throw new Error('No Azure endpoint configured. Set it in Admin → AI Settings.');
    if (!cfg.apiKey) throw new Error('No Azure API key configured. Set it in Admin → AI Settings.');
    const url = `${azureV1Base(cfg.baseUrl)}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
      body: JSON.stringify(chatCompletionsBody(model, messages, options)),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`azure request failed (${res.status}): ${detail.substring(0, 200)}`);
    }
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content ?? '', provider: 'azure', model };
  }

  // Groq, Grok and OpenAI all use the OpenAI-compatible /chat/completions shape
  if (!cfg.apiKey) {
    throw new Error(`No API key configured for ${cfg.provider}. Set it in Admin → AI Settings.`);
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(chatCompletionsBody(model, messages, options)),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${cfg.provider} request failed (${res.status}): ${detail.substring(0, 200)}`);
  }

  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';
  return { content, provider: cfg.provider, model };
}

/** Quick health probe for the configured provider. */
export async function probeProvider(): Promise<{ ok: boolean; provider: ProviderId; detail?: string }> {
  const cfg = getActiveProvider();

  if (cfg.provider === 'ollama') {
    try {
      const r = await fetch(`${cfg.baseUrl}/api/tags`, { method: 'GET' });
      return { ok: r.ok, provider: 'ollama' };
    } catch (e) {
      return { ok: false, provider: 'ollama', detail: String(e) };
    }
  }

  if (!cfg.apiKey) {
    return { ok: false, provider: cfg.provider, detail: 'No API key set' };
  }

  if (cfg.provider === 'azure') {
    if (!cfg.baseUrl) return { ok: false, provider: 'azure', detail: 'No endpoint set' };
    try {
      // Foundry project endpoints can run a deployment successfully while
      // rejecting /models. Probe the same chat path the app actually uses.
      await callChat(
        [
          { role: 'system', content: 'Reply with ok.' },
          { role: 'user', content: 'status' },
        ],
        { temperature: 0, maxTokens: 8 },
      );
      return { ok: true, provider: 'azure' };
    } catch (e) {
      return { ok: false, provider: 'azure', detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // Hit /models endpoint — both Grok and OpenAI expose it
  try {
    const r = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    return { ok: r.ok, provider: cfg.provider, detail: r.ok ? undefined : `${r.status}` };
  } catch (e) {
    return { ok: false, provider: cfg.provider, detail: String(e) };
  }
}
