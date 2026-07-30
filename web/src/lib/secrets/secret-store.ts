import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSecrets } from '@/lib/db/schema';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
  configured(key: string): Promise<boolean>;
}

const ENV_NAMES: Record<string, string> = {
  groq_api_key: 'GROQ_API_KEY',
  grok_api_key: 'GROK_API_KEY',
  openai_api_key: 'OPENAI_API_KEY',
  azure_api_key: 'AZURE_AI_API_KEY',
  azure_speech_key: 'AZURE_SPEECH_KEY',
};
const CLEARED_SECRET_MARKER = 'speaking-lab:cleared';

function vaultName(key: string) {
  return `speaking-lab-${key.replaceAll('_', '-')}`;
}

function encryptionKey(): Buffer {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error('SETTINGS_ENCRYPTION_KEY is required to persist local secrets.');
  }
  return createHash('sha256').update(configured, 'utf8').digest();
}

export function encryptLocalSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptLocalSecret(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Unsupported encrypted secret format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

class LocalSecretStore implements SecretStore {
  async get(key: string) {
    const environmentValue = process.env[ENV_NAMES[key] ?? key.toUpperCase()]?.trim();
    if (environmentValue) return environmentValue;
    const row = (await db.select().from(appSecrets).where(eq(appSecrets.key, key)).limit(1))[0];
    return row ? decryptLocalSecret(row.encryptedValue) : null;
  }

  async set(key: string, value: string) {
    if (!value) throw new Error('Secret value must not be empty.');
    const encryptedValue = encryptLocalSecret(value);
    await db.insert(appSecrets).values({
      key,
      encryptedValue,
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: appSecrets.key,
      set: {
        encryptedValue,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async clear(key: string) {
    await db.delete(appSecrets).where(eq(appSecrets.key, key));
  }

  async configured(key: string) {
    return Boolean(await this.get(key));
  }
}

class AzureKeyVaultSecretStore implements SecretStore {
  private readonly client: SecretClient;

  constructor(vaultUrl: string) {
    this.client = new SecretClient(vaultUrl, new DefaultAzureCredential());
  }

  async get(key: string) {
    try {
      const value = (await this.client.getSecret(vaultName(key))).value ?? null;
      return value === CLEARED_SECRET_MARKER ? null : value;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return null;
      throw error;
    }
  }

  async set(key: string, value: string) {
    if (!value) throw new Error('Secret value must not be empty.');
    await this.client.setSecret(vaultName(key), value, {
      contentType: 'application/x-speaking-lab-secret',
    });
  }

  async clear(key: string) {
    // A Key Vault delete is soft-deleted and prevents recreating the same
    // name until it is recovered or purged. A tombstone version makes the
    // credential immediately unconfigured while keeping later replacement
    // a normal setSecret operation.
    await this.client.setSecret(vaultName(key), CLEARED_SECRET_MARKER, {
      contentType: 'application/x-speaking-lab-cleared-secret',
    });
  }

  async configured(key: string) {
    return Boolean(await this.get(key));
  }
}

let singleton: SecretStore | undefined;

export function getSecretStore(): SecretStore {
  if (singleton) return singleton;
  const vaultUrl = process.env.AZURE_KEY_VAULT_URL?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (vaultUrl) {
      singleton = new AzureKeyVaultSecretStore(vaultUrl);
    } else if (process.env.ALLOW_LOCAL_ENCRYPTED_SECRET_STORE === 'true') {
      // Deterministic standalone/CI verification only. Azure infrastructure
      // intentionally never sets this escape hatch.
      singleton = new LocalSecretStore();
    } else {
      throw new Error('AZURE_KEY_VAULT_URL is required in production.');
    }
  } else {
    singleton = vaultUrl
      ? new AzureKeyVaultSecretStore(vaultUrl)
      : new LocalSecretStore();
  }
  return singleton;
}
