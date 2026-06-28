"use client"

export async function decodeToPcm16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  let out: Float32Array
  if (audioBuffer.numberOfChannels > 1) {
    const len = audioBuffer.length
    const chans: Float32Array[] = []
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) chans.push(audioBuffer.getChannelData(c))
    out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let s = 0
      for (const ch of chans) s += ch[i]
      out[i] = s / chans.length
    }
  } else {
    out = audioBuffer.getChannelData(0)
  }
  ctx.close()
  return out
}

export function pcmToWav(pcm: Float32Array, sampleRate: number): Blob {
  const n = pcm.length
  const view = new DataView(new ArrayBuffer(44 + n * 2))
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  w(0, "RIFF")
  view.setUint32(4, 36 + n * 2, true)
  w(8, "WAVE")
  w(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  w(36, "data")
  view.setUint32(40, n * 2, true)
  let off = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Blob([view], { type: "audio/wav" })
}
