import { readFileSync } from 'node:fs';

export function postgresSslConfig() {
  const mode = process.env.DATABASE_SSL_MODE?.trim().toLowerCase();
  if (mode === 'disable') return false;
  const caPath = process.env.DATABASE_SSL_CA_PATH?.trim();
  return {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
  };
}
