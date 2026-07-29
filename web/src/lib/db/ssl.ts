import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

export function postgresSslConfig(
  env: NodeJS.ProcessEnv = process.env,
): false | ConnectionOptions | undefined {
  const mode = env.DATABASE_SSL_MODE?.trim().toLowerCase();
  if (mode === 'disable') return false;

  if (
    mode !== 'require' &&
    mode !== 'verify-full' &&
    env.NODE_ENV !== 'production'
  ) {
    return undefined;
  }

  const caPath = env.DATABASE_SSL_CA_PATH?.trim();
  return {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
  };
}
