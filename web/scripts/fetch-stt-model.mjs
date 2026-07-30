// Download the bundled offline STT model into public/models so the standalone
// app needs ZERO network for speech recognition — even on first launch.
//
//   node scripts/fetch-stt-model.mjs
//
// We bundle Xenova/whisper-tiny.en with fp32 (full-precision) ONNX weights.
// Why fp32 and not a smaller quantized build: the q8/uint8 Whisper exports use
// MatMulNBits ops that onnxruntime-web 1.26 (what Transformers.js v4 ships)
// cannot load ("Missing required scale … MatMulNBits"). fp32 loads reliably and
// is faster on the browser WASM backend used by the hosted application (no
// per-op dequantization). Tiny keeps inference responsive in single-threaded WASM.
//
// Transformers.js loads from `${env.localModelPath}/${modelId}/...`, and
// The Docker runner copies public/ beside the standalone server bundle, so
// anything we drop here ships with the app automatically.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(__dirname, "..")
const MODEL_ID = "Xenova/whisper-tiny.en"
const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`
const OUT_DIR = path.join(WEB, "public", "models", ...MODEL_ID.split("/"))

// fp32 ONNX graphs (no precision suffix) + the small tokenizer/config files.
const REQUIRED = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model.onnx",
  "onnx/decoder_model_merged.onnx",
]
const OPTIONAL = [
  "added_tokens.json",
  "special_tokens_map.json",
  "normalizer.json",
  "vocab.json",
  "merges.txt",
]

async function download(rel, { optional } = {}) {
  const url = `${BASE}/${rel}`
  const dest = path.join(OUT_DIR, ...rel.split("/"))
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  ✓ ${rel} (already present, ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`)
    return true
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) {
    if (optional && res.status === 404) { console.log(`  – ${rel} (not in repo, skipped)`); return true }
    console.error(`  ✗ ${rel} — HTTP ${res.status}`)
    return false
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`  ✓ ${rel} (${(buf.length / 1e6).toFixed(1)} MB)`)
  return true
}

console.log(`Fetching ${MODEL_ID} (fp32) → ${path.relative(WEB, OUT_DIR)}`)
let ok = true
for (const f of REQUIRED) ok = (await download(f, { optional: false })) && ok
for (const f of OPTIONAL) await download(f, { optional: true })

if (!ok) {
  console.error("\n✗ One or more required model files failed to download.")
  process.exit(1)
}

// Size summary
let total = 0
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size } }
walk(OUT_DIR)
console.log(`\n✓ Model ready (${(total / 1e6).toFixed(1)} MB total) at ${path.relative(WEB, OUT_DIR)}`)

// ── Bundle the ONNX-runtime WASM so inference needs no CDN either ──────────
// Transformers.js fetches the ORT wasm from a CDN by default; we serve it from
// /public/ort instead. Copy every ort-wasm-simd-threaded.* variant so whichever
// flavour the runtime picks (asyncify in our case) is present.
const ORT_SRC = path.join(WEB, "node_modules", "onnxruntime-web", "dist")
const ORT_DST = path.join(WEB, "public", "ort")
if (fs.existsSync(ORT_SRC)) {
  fs.mkdirSync(ORT_DST, { recursive: true })
  let copied = 0, ortBytes = 0
  for (const f of fs.readdirSync(ORT_SRC)) {
    if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(f)) {
      const dest = path.join(ORT_DST, f)
      if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(path.join(ORT_SRC, f)).size) {
        fs.copyFileSync(path.join(ORT_SRC, f), dest)
      }
      copied++; ortBytes += fs.statSync(dest).size
    }
  }
  console.log(`✓ ONNX runtime ready (${copied} files, ${(ortBytes / 1e6).toFixed(1)} MB) at public/ort`)
} else {
  console.warn("⚠ onnxruntime-web not found in node_modules — run `npm install` first.")
}
