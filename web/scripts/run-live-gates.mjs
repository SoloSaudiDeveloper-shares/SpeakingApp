import { spawn } from 'node:child_process';

const port = process.env.TEST_PORT || '3100';
process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${port}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}.`));
    });
  });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${process.env.TEST_BASE_URL}/api/health/live`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Development server did not become ready.');
}

const server = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '-p', port],
  { env: process.env, stdio: 'inherit', windowsHide: true },
);

try {
  await waitUntilReady();
  await run(process.execPath, ['scripts/learning-quality-check.mjs']);
  await run(process.execPath, ['scripts/mutation-check.mjs']);
} finally {
  server.kill();
}
