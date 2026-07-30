"use client"

/**
 * Shared Web Audio playback for neural TTS engines. Each new playback owns a
 * generation so decoded output from an older utterance cannot start after a
 * newer utterance has taken over.
 */

let ctx: AudioContext | null = null
let playbackGeneration = 0
let activePlayback: {
  source: AudioBufferSourceNode;
  cancel: (reason?: unknown) => void;
} | null = null

async function getCtx(): Promise<AudioContext> {
  if (!ctx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC = window.AudioContext || (window as any).webkitAudioContext
    ctx = new AC()
  }
  if (ctx.state === "suspended") await ctx.resume()
  if (ctx.state !== "running") {
    throw new Error(
      `Audio output is ${ctx.state}. Click Test Voice again or check browser audio permissions.`,
    )
  }
  return ctx
}

function cancellationError(reason?: unknown): unknown {
  return reason ?? new DOMException("Speech playback was cancelled.", "AbortError")
}

function beginPlayback(reason?: unknown): number {
  playbackGeneration += 1
  const active = activePlayback
  activePlayback = null
  active?.cancel(cancellationError(reason))
  return playbackGeneration
}

function assertCurrent(generation: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError(signal.reason)
  if (generation !== playbackGeneration) throw cancellationError()
}

/** Stop current playback and settle its pending promise as cancelled. */
export function stopPlayback(reason?: unknown): void {
  beginPlayback(reason)
}

async function playPcmForGeneration(
  generation: number,
  audio: Float32Array,
  sampleRate: number,
  opts?: { volume?: number; rate?: number; signal?: AbortSignal },
): Promise<void> {
  if (audio.length === 0) throw new Error("TTS produced empty audio.")
  assertCurrent(generation, opts?.signal)
  const c = await getCtx()
  assertCurrent(generation, opts?.signal)
  const buffer = c.createBuffer(1, audio.length, sampleRate)
  buffer.getChannelData(0).set(audio)

  const source = c.createBufferSource()
  source.buffer = buffer
  if (opts?.rate && opts.rate !== 1) {
    source.playbackRate.value = Math.max(0.5, Math.min(2, opts.rate))
  }
  const gain = c.createGain()
  gain.gain.value = opts?.volume ?? 1
  source.connect(gain).connect(c.destination)

  return new Promise<void>((resolve, reject) => {
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      opts?.signal?.removeEventListener("abort", onAbort)
      if (activePlayback?.source === source) activePlayback = null
      source.onended = null
    }
    const finish = (callback: () => void) => {
      if (finished) return
      finished = true
      cleanup()
      callback()
    }
    const cancel = (reason?: unknown) => {
      finish(() => {
        try { source.stop() } catch { /* already stopped */ }
        reject(cancellationError(reason))
      })
    }
    const onAbort = () => cancel(opts?.signal?.reason)
    const durationMs = Math.max(5000, (audio.length / sampleRate) * 1000 + 5000)
    timeout = setTimeout(() => {
      finish(() => {
        try { source.stop() } catch { /* already stopped */ }
        reject(new Error("Audio playback timed out before the voice preview finished."))
      })
    }, durationMs)
    source.onended = () => finish(resolve)
    activePlayback = { source, cancel }
    if (opts?.signal?.aborted || generation !== playbackGeneration) {
      cancel(opts?.signal?.reason)
      return
    }
    opts?.signal?.addEventListener("abort", onAbort, { once: true })
    try {
      source.start()
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

export async function playPcm(
  audio: Float32Array,
  sampleRate: number,
  opts?: { volume?: number; rate?: number; signal?: AbortSignal },
): Promise<void> {
  const generation = beginPlayback()
  return playPcmForGeneration(generation, audio, sampleRate, opts)
}

/** Decode a WAV/audio Blob (for example Piper) and play only if still current. */
export async function playBlob(
  blob: Blob,
  opts?: { volume?: number; rate?: number; signal?: AbortSignal },
): Promise<void> {
  const generation = beginPlayback()
  assertCurrent(generation, opts?.signal)
  const arrayBuffer = await blob.arrayBuffer()
  assertCurrent(generation, opts?.signal)
  const c = await getCtx()
  const decoded = await c.decodeAudioData(arrayBuffer)
  assertCurrent(generation, opts?.signal)
  return playPcmForGeneration(
    generation,
    decoded.getChannelData(0),
    decoded.sampleRate,
    opts,
  )
}
