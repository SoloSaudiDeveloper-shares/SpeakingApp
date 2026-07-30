import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const standaloneRoot = path.resolve('.next/standalone');
const serverChunks = path.join(standaloneRoot, '.next', 'server', 'chunks');
const browserOnlyMarkers = [
  '@huggingface',
  '@mintplex-labs',
  'piper-tts',
  'phonemizer',
];

let removedChunks = 0;
async function pruneDirectory(directory) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await pruneDirectory(fullPath);
      continue;
    }
    if (browserOnlyMarkers.some((marker) => entry.name.includes(marker))) {
      await rm(fullPath, { force: true });
      removedChunks += 1;
    }
  }
}

await pruneDirectory(serverChunks);
await rm(path.join(standaloneRoot, '.next', 'node_modules', '@huggingface'), {
  recursive: true,
  force: true,
});
console.log(`[standalone] Removed ${removedChunks} browser-only server chunks.`);
