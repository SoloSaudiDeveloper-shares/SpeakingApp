import { spawn } from 'node:child_process';

export function postgresCommandConnection(databaseUrl: string, databaseOverride?: string) {
  const url = new URL(databaseUrl);
  return {
    args: [
      '--host', url.hostname,
      '--port', url.port || '5432',
      '--username', decodeURIComponent(url.username),
      '--dbname', databaseOverride || url.pathname.replace(/^\//, ''),
    ],
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE:
        process.env.DATABASE_SSL_MODE === 'disable'
          ? 'disable'
          : 'verify-full',
      ...(process.env.DATABASE_SSL_MODE === 'disable' ||
      !process.env.DATABASE_SSL_CA_PATH
        ? {}
        : { PGSSLROOTCERT: process.env.DATABASE_SSL_CA_PATH }),
    },
  };
}

export async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
  });
}
