// End-to-end speech recognition test using Transformers.js + a known audio file.
// Run: node scripts/test-transformers-stt.mjs

import { pipeline } from "@huggingface/transformers"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import wav from "wavefile"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.join(__dirname, "..", ".test-cache")
fs.mkdirSync(CACHE_DIR, { recursive: true })

// JFK's "And so my fellow Americans..." — the canonical Whisper test sample
// from Xenova's transformers.js docs. Public-domain US gov speech.
const AUDIO_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav"
const EXPECTED_TRANSCRIPT_KEYWORDS = [
  "ask not what your country",
  "what you can do for your country",
]

async function downloadAudio() {
  const cached = path.join(CACHE_DIR, "jfk.wav")
  if (fs.existsSync(cached)) {
    console.log(`✓ Using cached audio at ${cached}`)
    return cached
  }
  console.log(`↓ Downloading test audio from ${AUDIO_URL}`)
  const res = await fetch(AUDIO_URL)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(cached, buf)
  console.log(`✓ Saved ${buf.length} bytes to ${cached}`)
  return cached
}

function loadWavAsFloat32(filePath) {
  const buffer = fs.readFileSync(filePath)
  const wf = new wav.WaveFile(buffer)
  // Force to 32-bit float at 16 kHz mono — Whisper's expected input
  wf.toBitDepth("32f")
  wf.toSampleRate(16000)
  let samples = wf.getSamples()
  if (Array.isArray(samples)) {
    // stereo → average channels
    const left = samples[0]
    const right = samples[1] ?? samples[0]
    const out = new Float32Array(left.length)
    for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2
    samples = out
  }
  return samples
}

async function runWhisper(audioFloat32, modelId) {
  console.log(`\n— Loading model: ${modelId}`)
  const start = Date.now()
  const transcriber = await pipeline("automatic-speech-recognition", modelId)
  console.log(`✓ Model loaded in ${(Date.now() - start) / 1000}s`)

  const tStart = Date.now()
  const result = await transcriber(audioFloat32)
  const tMs = Date.now() - tStart

  const text = (result?.text ?? result?.transcription ?? String(result ?? "")).trim()
  console.log(`✓ Transcribed in ${tMs / 1000}s`)
  console.log(`  Output: "${text}"`)
  return { text, durationMs: tMs }
}

function checkTranscript(actual, expectedKeywords) {
  const lower = actual.toLowerCase()
  const matched = expectedKeywords.filter((k) => lower.includes(k.toLowerCase()))
  const missing = expectedKeywords.filter((k) => !lower.includes(k.toLowerCase()))
  return { matched, missing, ok: missing.length === 0 }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════")
  console.log("  Transformers.js Speech-to-Text End-to-End Test")
  console.log("═══════════════════════════════════════════════════════════\n")

  // 1. Download
  const audioPath = await downloadAudio()

  // 2. Decode
  console.log(`\n— Decoding audio to 16kHz mono Float32`)
  const audio = loadWavAsFloat32(audioPath)
  console.log(`✓ Got ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`)

  // 3. Try multiple models, smallest first
  const models = [
    "Xenova/whisper-tiny.en",
    // Could also try: "onnx-community/moonshine-base-ONNX",
  ]

  let allPassed = true
  for (const modelId of models) {
    try {
      const { text } = await runWhisper(audio, modelId)
      const check = checkTranscript(text, EXPECTED_TRANSCRIPT_KEYWORDS)

      console.log(`\n  Expected keywords: ${EXPECTED_TRANSCRIPT_KEYWORDS.map(k => `"${k}"`).join(", ")}`)
      console.log(`  Matched: ${check.matched.length}/${EXPECTED_TRANSCRIPT_KEYWORDS.length}`)

      if (check.ok) {
        console.log(`  ✅ PASS — all expected keywords present`)
      } else {
        console.log(`  ❌ FAIL — missing: ${check.missing.map(k => `"${k}"`).join(", ")}`)
        allPassed = false
      }
    } catch (e) {
      console.log(`  ❌ FAIL — ${e.message}`)
      allPassed = false
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════`)
  console.log(`  ${allPassed ? "✅ ALL TESTS PASSED" : "❌ TESTS FAILED"}`)
  console.log(`═══════════════════════════════════════════════════════════`)
  process.exit(allPassed ? 0 : 1)
}

main().catch((e) => {
  console.error("\n❌ Fatal error:", e)
  process.exit(1)
})
