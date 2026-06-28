// End-to-end test: Silero VAD + Moonshine streaming on the JFK audio.
// Simulates what the browser engine does: chunks audio in 512-sample windows,
// runs VAD continuously, transcribes when VAD detects speech end.
// Run: node scripts/test-moonshine-streaming.mjs

import { AutoModel, pipeline, Tensor, env } from "@huggingface/transformers"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import wav from "wavefile"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.join(__dirname, "..", ".test-cache")

const SAMPLE_RATE = 16000
const VAD_CHUNK_SIZE = 512
const SPEECH_THRESHOLD = 0.3
const EXIT_THRESHOLD = 0.1
const MIN_SILENCE_SAMPLES = 24000 // 1500ms — matches the engine
const SPEECH_PAD_SAMPLES = 1280
const MIN_SPEECH_SAMPLES = 4000
const MAX_BUFFER_DURATION = 30
const MAX_NUM_PREV_BUFFERS = Math.ceil(SPEECH_PAD_SAMPLES / VAD_CHUNK_SIZE)

env.allowRemoteModels = true

function loadAudio(filePath) {
  const buffer = fs.readFileSync(filePath)
  const wf = new wav.WaveFile(buffer)
  wf.toBitDepth("32f")
  wf.toSampleRate(SAMPLE_RATE)
  let samples = wf.getSamples()
  if (Array.isArray(samples)) {
    const left = samples[0]
    const right = samples[1] ?? samples[0]
    const out = new Float32Array(left.length)
    for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2
    samples = out
  }
  return samples
}

async function main() {
  console.log("══════════════════════════════════════════════════════════")
  console.log("  Streaming Moonshine + Silero VAD test")
  console.log("══════════════════════════════════════════════════════════\n")

  const audioPath = path.join(CACHE_DIR, "jfk.wav")
  if (!fs.existsSync(audioPath)) {
    console.log("Cached audio not found. Fetching...")
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    const r = await fetch("https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav")
    fs.writeFileSync(audioPath, Buffer.from(await r.arrayBuffer()))
  }

  console.log(`✓ Loaded ${audioPath}`)
  const audio = loadAudio(audioPath)
  console.log(`✓ Decoded ${audio.length} samples (${(audio.length / SAMPLE_RATE).toFixed(2)}s)`)

  console.log("\n— Loading Silero VAD")
  const t0 = Date.now()
  const silero = await AutoModel.from_pretrained("onnx-community/silero-vad", {
    config: { model_type: "custom" },
    dtype: "fp32",
  })
  console.log(`✓ VAD loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  console.log("\n— Loading Moonshine Base (more accurate than tiny)")
  const t1 = Date.now()
  const transcriber = await pipeline("automatic-speech-recognition", "onnx-community/moonshine-base-ONNX", {
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
  })
  console.log(`✓ Moonshine loaded in ${((Date.now() - t1) / 1000).toFixed(1)}s`)

  // Warm up
  await transcriber(new Float32Array(SAMPLE_RATE))

  // Initial VAD state
  const sr = new Tensor("int64", [BigInt(SAMPLE_RATE)], [])
  let state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128])

  // Streaming state
  const fullBuffer = new Float32Array(MAX_BUFFER_DURATION * SAMPLE_RATE)
  let bufferPointer = 0
  let isRecording = false
  let postSpeechSamples = 0
  let prevBuffers = []
  const fragments = []

  const emitFragment = async (overflow) => {
    const segment = fullBuffer.slice(0, bufferPointer + SPEECH_PAD_SAMPLES)
    const prevLen = prevBuffers.reduce((a, b) => a + b.length, 0)
    const padded = new Float32Array(prevLen + segment.length)
    let off = 0
    for (const p of prevBuffers) { padded.set(p, off); off += p.length }
    padded.set(segment, off)

    if (overflow && overflow.length > 0) {
      fullBuffer.fill(0)
      fullBuffer.set(overflow, 0)
      bufferPointer = overflow.length
    } else {
      fullBuffer.fill(0)
      bufferPointer = 0
    }
    isRecording = false
    postSpeechSamples = 0
    prevBuffers = []

    const t = Date.now()
    const res = await transcriber(padded)
    const text = (res?.text ?? "").trim()
    console.log(`  → "${text}"  (transcribed in ${Date.now() - t}ms)`)
    if (text) fragments.push(text)
  }

  console.log("\n— Streaming through audio in 512-sample chunks")
  let segmentCount = 0
  for (let i = 0; i + VAD_CHUNK_SIZE <= audio.length; i += VAD_CHUNK_SIZE) {
    const chunk = audio.slice(i, i + VAD_CHUNK_SIZE)
    const wasRecording = isRecording

    const input = new Tensor("float32", chunk, [1, chunk.length])
    const result = await silero({ input, sr, state })
    state = result.stateN
    const prob = result.output.data[0]
    const isSpeech = prob > SPEECH_THRESHOLD || (isRecording && prob >= EXIT_THRESHOLD)

    if (!wasRecording && !isSpeech) {
      if (prevBuffers.length >= MAX_NUM_PREV_BUFFERS) prevBuffers.shift()
      prevBuffers.push(chunk)
      continue
    }

    const remaining = fullBuffer.length - bufferPointer
    if (chunk.length >= remaining) {
      fullBuffer.set(chunk.subarray(0, remaining), bufferPointer)
      bufferPointer += remaining
      const overflow = chunk.subarray(remaining)
      segmentCount++
      console.log(`\nSegment #${segmentCount} (buffer overflow at ${(i/SAMPLE_RATE).toFixed(1)}s):`)
      await emitFragment(overflow)
      continue
    }
    fullBuffer.set(chunk, bufferPointer)
    bufferPointer += chunk.length

    if (isSpeech) {
      if (!isRecording) console.log(`\n[${(i/SAMPLE_RATE).toFixed(1)}s] Speech started (prob=${prob.toFixed(2)})`)
      isRecording = true
      postSpeechSamples = 0
      continue
    }

    postSpeechSamples += chunk.length
    if (postSpeechSamples < MIN_SILENCE_SAMPLES) continue

    if (bufferPointer < MIN_SPEECH_SAMPLES) {
      bufferPointer = 0
      isRecording = false
      postSpeechSamples = 0
      prevBuffers = []
      continue
    }

    segmentCount++
    console.log(`\n[${(i/SAMPLE_RATE).toFixed(1)}s] Segment #${segmentCount} ended (silence ${(postSpeechSamples/SAMPLE_RATE*1000).toFixed(0)}ms):`)
    await emitFragment()
  }

  // Flush any remaining buffer
  if (bufferPointer >= MIN_SPEECH_SAMPLES) {
    segmentCount++
    console.log(`\nFinal segment #${segmentCount} (end of audio):`)
    await emitFragment()
  }

  const transcript = fragments.join(" ")
  console.log("\n══════════════════════════════════════════════════════════")
  console.log(`  Final transcript: "${transcript}"`)
  console.log(`  Segments produced: ${fragments.length}`)
  console.log("══════════════════════════════════════════════════════════")

  const expected = ["ask not what your country", "what you can do for your country"]
  const lower = transcript.toLowerCase()
  const matched = expected.filter(k => lower.includes(k))
  if (matched.length === expected.length) {
    console.log(`  ✅ PASS — all ${expected.length} expected phrases present`)
    process.exit(0)
  } else {
    console.log(`  ❌ FAIL — matched ${matched.length}/${expected.length}`)
    expected.filter(k => !lower.includes(k)).forEach(k => console.log(`    missing: "${k}"`))
    process.exit(1)
  }
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})
