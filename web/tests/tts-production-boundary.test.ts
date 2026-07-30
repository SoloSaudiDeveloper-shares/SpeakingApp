import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { TTS_PROVIDER_META } from '@/app/admin/models/tts/voice-settings';
import { TTS_ENGINE_OPTIONS } from '@/lib/speech/tts-engines/types';

const repositoryRoot = resolve(process.cwd(), '..');

describe('production TTS boundary', () => {
  test('does not expose browser neural providers or engines as selectable options', () => {
    expect(TTS_PROVIDER_META.map((provider) => provider.id)).not.toContain('browser-local');
    expect(TTS_ENGINE_OPTIONS.map((engine) => engine.id)).toEqual(['browser-tts']);
  });

  test('excludes the browser Kokoro package from the production Docker context and build', () => {
    const modelPath = 'web/public/models/onnx-community/Kokoro-82M-v1.0-ONNX';
    const dockerIgnore = readFileSync(resolve(repositoryRoot, '.dockerignore'), 'utf8');
    const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');

    expect(dockerIgnore.split(/\r?\n/)).toContain(modelPath);
    expect(dockerfile).toContain(
      'test ! -e public/models/onnx-community/Kokoro-82M-v1.0-ONNX',
    );
  });

  test('keeps companion request limits, install deadline, cleanup, and WAV contract explicit', () => {
    const program = readFileSync(
      resolve(repositoryRoot, 'companion/src/SpeakingLab.Companion/Program.cs'),
      'utf8',
    );
    const worker = readFileSync(resolve(repositoryRoot, 'companion/worker/main.py'), 'utf8');

    expect(program).toContain('kestrel.Limits.MaxRequestBodySize = 16_384');
    expect(program).toContain('bodySize.MaxRequestBodySize = endpointLimit');
    expect(program).toContain('TimeSpan WholeInstallTimeout = TimeSpan.FromMinutes(10)');
    expect(program).toContain('CancellationTokenSource.CreateLinkedTokenSource(ct)');
    expect(program).toContain('CleanupStaleDownloadDirectories(stagingDirectory)');
    expect(program).toContain('response_format_must_be_wav');
    expect(worker).toContain('response_format: Literal["wav"] = "wav"');
  });
});
