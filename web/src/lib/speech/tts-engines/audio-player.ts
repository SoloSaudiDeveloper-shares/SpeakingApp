"use client"

/**
 * Shared Web Audio playback for neural TTS engines (Kokoro, Piper), which
 * produce raw PCM / WAV rather than driving the OS speech synthesizer.
 * Only one utterance plays at a time; starting a new one stops the previous.
 */

let ctx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null

async function getCtx(): Promise<AudioContext> {
  if (!ctx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC = window.AudioContext || (window as any).webkitAudioContext
    ctx = new AC()
  }
  // Resume if the browser suspended it (autoplay policy)
  if (ctx.state === "suspended") await ctx.resume()
  if (ctx.state !== "running") throw new Error(`Audio output is ${ctx.state}. Click Test Voice again or check browser audio permissions.`)
  return ctx
}

/** Stop whatever is currently playing. */
export function stopPlayback(): void {
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop() } catch { /* already stopped */ }
    currentSource = null
  }
}

/**
 * Play mono PCM and resolve when it finishes (or is stopped).
 * `rate` adjusts playback speed for engines that can't set speed natively
 * (note: it shifts pitch slightly — Kokoro instead bakes speed into synthesis).
 */
export async function playPcm(
  audio: Float32Array,
  sampleRate: number,
  opts?: { volume?: number; rate?: number },
): Promise<void> {
  stopPlayback()
  if (audio.length === 0) throw new Error("TTS produced empty audio.")
  const c = await getCtx()
  const buffer = c.createBuffer(1, audio.length, sampleRate)
  buffer.getChannelData(0).set(audio)

  const source = c.createBufferSource()
  source.buffer = buffer
  if (opts?.rate && opts.rate !== 1) source.playbackRate.value = Math.max(0.5, Math.min(2, opts.rate))

  const gain = c.createGain()
  gain.gain.value = opts?.volume ?? 1
  source.connect(gain).connect(c.destination)

  currentSource = source
  return new Promise<void>((resolve, reject) => {
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      if (currentSource === source) currentSource = null
      source.onended = null
    }
    const durationMs = Math.max(5000, (audio.length / sampleRate) * 1000 + 5000)
    timeout = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      try { source.stop() } catch { /* already stopped */ }
      reject(new Error("Audio playback timed out before the voice preview finished."))
    }, durationMs)
    source.onended = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }
    try {
      source.start()
    } catch (error) {
      finished = true
      cleanup()
      reject(error)
    }
  })
}

/** Decode a WAV/audio Blob (e.g. from Piper) to PCM and play it. */
export async function playBlob(
  blob: Blob,
  opts?: { volume?: number; rate?: number },
): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer()
  const c = await getCtx()
  const decoded = await c.decodeAudioData(arrayBuffer)
  const channel = decoded.getChannelData(0)
  return playPcm(channel, decoded.sampleRate, opts)
}
