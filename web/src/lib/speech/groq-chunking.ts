export type TimedWord = { word: string; start: number; end: number };
export type ChunkRange = {
  index: number;
  startSample: number;
  endSample: number;
  offsetSeconds: number;
};

export function buildOverlappingChunkRanges(
  sampleCount: number,
  sampleRate = 16_000,
  chunkSeconds = 30,
  overlapSeconds = 1,
): ChunkRange[] {
  if (sampleCount <= 0 || sampleRate <= 0 || chunkSeconds <= overlapSeconds) return [];
  const chunkLength = Math.round(chunkSeconds * sampleRate);
  const step = Math.round((chunkSeconds - overlapSeconds) * sampleRate);
  const ranges: ChunkRange[] = [];
  for (let startSample = 0, index = 0; startSample < sampleCount; startSample += step, index += 1) {
    const endSample = Math.min(sampleCount, startSample + chunkLength);
    ranges.push({ index, startSample, endSample, offsetSeconds: startSample / sampleRate });
    if (endSample >= sampleCount) break;
  }
  return ranges;
}

function normalizedWord(value: string) {
  return value.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}']/gu, '');
}

export function mergeTimestampedWordChunks(
  chunks: Array<{ offsetSeconds: number; words: TimedWord[] }>,
): TimedWord[] {
  const merged: TimedWord[] = [];
  for (const chunk of chunks) {
    for (const word of chunk.words) {
      const candidate = {
        word: word.word.trim(),
        start: word.start + chunk.offsetSeconds,
        end: word.end + chunk.offsetSeconds,
      };
      if (!candidate.word || !Number.isFinite(candidate.start) || !Number.isFinite(candidate.end)) continue;
      const token = normalizedWord(candidate.word);
      const duplicate = merged.slice(-12).some((existing) =>
        normalizedWord(existing.word) === token &&
        Math.abs(existing.start - candidate.start) <= 0.35 &&
        Math.abs(existing.end - candidate.end) <= 0.35,
      );
      if (!duplicate) merged.push(candidate);
    }
  }
  return merged.sort((left, right) => left.start - right.start || left.end - right.end);
}

export async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  let firstError: unknown;
  try {
    return await operation();
  } catch (error) {
    firstError = error;
  }
  try {
    return await operation();
  } catch (error) {
    throw error ?? firstError;
  }
}
