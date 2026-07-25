// Download the bundled offline TTS assets into public/ so the standalone app
// can speak with high-quality neural voices using ZERO network — even on first
// launch. Mirrors scripts/fetch-stt-model.mjs.
//
//   node scripts/fetch-tts-models.mjs
//
// Engines:
//   • Kokoro-82M (Apache-2.0) — runs on the app's @huggingface/transformers v4
//     (StyleTextToSpeech2) + the phonemizer package, reusing the ONNX runtime
//     already bundled in public/ort. We bundle the model ONNX + tokenizer +
//     a curated set of voice style vectors.
//   • Piper voices are handled separately (piper-tts-web) in a later step.
//
// Transformers.js loads from `${env.localModelPath}/${modelId}/...`, and
// The Docker runner copies public/ beside the standalone server bundle.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(__dirname, "..")

// ── Kokoro-82M ────────────────────────────────────────────────────────────
const KOKORO_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"
const KOKORO_BASE = `https://huggingface.co/${KOKORO_ID}/resolve/main`
const KOKORO_OUT = path.join(WEB, "public", "models", ...KOKORO_ID.split("/"))

// Which ONNX precision to bundle. transformers.js's wasm default dtype "q8"
// maps to model_quantized.onnx (92 MB) — verified to load + synthesize offline.
// (Keep in sync with DTYPE in kokoro-tts-engine.ts.)
const KOKORO_ONNX = process.env.KOKORO_ONNX || "model_quantized.onnx"

// Curated, high-quality American + British, male + female voices (~510 KB each).
const KOKORO_VOICES = [
  "af_heart", "af_bella", "af_nicole", "af_sarah",
  "am_michael", "am_adam", "am_fenrir", "am_puck",
  "bf_emma", "bf_isabella", "bm_george", "bm_fable",
]

const KOKORO_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  `onnx/${KOKORO_ONNX}`,
  ...KOKORO_VOICES.map((v) => `voices/${v}.bin`),
]

async function download(base, rel, outDir) {
  const url = `${base}/${rel}`
  const dest = path.join(outDir, ...rel.split("/"))
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  ✓ ${rel} (present, ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`)
    return true
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) { console.error(`  ✗ ${rel} — HTTP ${res.status}`); return false }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`  ✓ ${rel} (${(buf.length / 1e6).toFixed(2)} MB)`)
  return true
}

console.log(`Fetching Kokoro-82M (${KOKORO_ONNX}) → ${path.relative(WEB, KOKORO_OUT)}`)
let ok = true
for (const f of KOKORO_FILES) ok = (await download(KOKORO_BASE, f, KOKORO_OUT)) && ok
if (!ok) { console.error("\n✗ Some Kokoro files failed to download."); process.exit(1) }

let total = 0
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size } }
walk(KOKORO_OUT)
console.log(`\n✓ Kokoro ready (${(total / 1e6).toFixed(1)} MB, ${KOKORO_VOICES.length} voices) at ${path.relative(WEB, KOKORO_OUT)}`)
