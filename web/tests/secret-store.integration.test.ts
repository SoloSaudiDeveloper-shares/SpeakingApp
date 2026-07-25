import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { pool } from '@/lib/db';
import { getSecretStore } from '@/lib/secrets/secret-store';

const key = `test_secret_${randomBytes(5).toString('hex')}`;
const value = `provider-value-${randomBytes(12).toString('base64url')}`;

describe('local development SecretStore', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM app_secrets WHERE key=$1`, [key]);
  });

  test('persists only AES-256-GCM ciphertext and supports replacement and clearing', async () => {
    const store = getSecretStore();
    await store.set(key, value);
    const row = await pool.query<{ encrypted_value: string }>(
      `SELECT encrypted_value FROM app_secrets WHERE key=$1`,
      [key],
    );
    expect(row.rows[0].encrypted_value).toMatch(/^v1:/);
    expect(row.rows[0].encrypted_value).not.toContain(value);
    await expect(store.get(key)).resolves.toBe(value);
    await expect(store.configured(key)).resolves.toBe(true);
    await store.clear(key);
    await expect(store.get(key)).resolves.toBeNull();
  });
});
