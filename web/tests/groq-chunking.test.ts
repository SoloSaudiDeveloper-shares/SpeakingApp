import { describe, expect, test } from 'vitest';
import {
  buildOverlappingChunkRanges,
  mergeTimestampedWordChunks,
  retryOnce,
} from '@/lib/speech/groq-chunking';

describe('90-second Groq transcription control', () => {
  test('covers the beginning, middle, and end with overlapping 30-second chunks', () => {
    const ranges = buildOverlappingChunkRanges(90 * 16_000);
    expect(ranges.map((range) => [range.offsetSeconds, range.endSample / 16_000])).toEqual([
      [0, 30],
      [29, 59],
      [58, 88],
      [87, 90],
    ]);
  });

  test('merges timestamped overlap without losing known beginning, middle, or end phrases', () => {
    const words = mergeTimestampedWordChunks([
      {
        offsetSeconds: 0,
        words: [
          { word: 'BEGINNING', start: 1, end: 1.4 },
          { word: 'bridge', start: 29.2, end: 29.6 },
        ],
      },
      {
        offsetSeconds: 29,
        words: [
          { word: 'bridge', start: 0.21, end: 0.61 },
          { word: 'MIDDLE', start: 16, end: 16.5 },
        ],
      },
      {
        offsetSeconds: 58,
        words: [
          { word: 'late', start: 12, end: 12.4 },
          { word: 'handoff', start: 29.2, end: 29.6 },
        ],
      },
      {
        offsetSeconds: 87,
        words: [
          { word: 'handoff', start: 0.21, end: 0.61 },
          { word: 'END', start: 2, end: 2.4 },
        ],
      },
    ]);
    expect(words.map((word) => word.word)).toEqual([
      'BEGINNING',
      'bridge',
      'MIDDLE',
      'late',
      'handoff',
      'END',
    ]);
    expect(words.at(-1)?.start).toBe(89);
  });

  test('retries one failed chunk once and then fails closed', async () => {
    let recoverableCalls = 0;
    await expect(retryOnce(async () => {
      recoverableCalls += 1;
      if (recoverableCalls === 1) throw new Error('temporary');
      return 'complete';
    })).resolves.toBe('complete');
    expect(recoverableCalls).toBe(2);

    let failedCalls = 0;
    await expect(retryOnce(async () => {
      failedCalls += 1;
      throw new Error('still unavailable');
    })).rejects.toThrow('still unavailable');
    expect(failedCalls).toBe(2);
  });
});
