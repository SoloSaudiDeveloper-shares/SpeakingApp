// One-shot, bulletproof build of the Speaking Lab standalone Windows app.
//
//   npm run dist
//
// Steps (each verified before continuing):
//   1. Kill any running app/electron processes that would lock files
//   2. Clean previous build output (.next, ../dist)
//   3. Rebuild better-sqlite3 for system Node (so `next build` can run it)
//   4. next build  (produces .next/standalone)
//   5. prepare-electron-build.mjs  (mirror static assets, resolve symlinks)
//   6. Rebuild better-sqlite3 for Electron's ABI (clears electron-gyp cache first)
//   7. Verify the Electron-ABI binary actually loads under Electron's node
//   8. electron-builder  (package into dist/win-unpacked + zip)
//   9. post-electron-build.mjs  (copy the Electron-ABI binary into the bundle)
//  10. Final sanity check that the packaged binary has the right ABI

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(__dirname, "..")
const ELECTRON_VERSION = "31.7.7"

function log(msg) {
  console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`)
}
function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { cwd: WEB, stdio: "inherit", ...opts })
}
function runQuiet(cmd) {
  return execSync(cmd, { cwd: WEB, stdio: ["ignore", "pipe", "pipe"] }).toString()
}
function removeGeneratedModelCaches() {
  const roots = [
    path.join(WEB, "node_modules", "@huggingface"),
    path.join(WEB, ".next", "standalone"),
  ]
  const stack = roots.filter((root) => fs.existsSync(root))
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      const isTransformersCache =
        entry.name === ".cache" &&
        child.includes(`${path.sep}@huggingface${path.sep}transformers`)
      if (isTransformersCache) {
        fs.rmSync(child, { recursive: true, force: true })
        console.log(`  removed ${path.relative(WEB, child)}`)
      } else {
        stack.push(child)
      }
    }
  }
}

// ── Step 1: kill locking processes ──────────────────────────────────
log("Killing any running app/electron processes")
for (const img of ["Speaking Lab.exe", "electron.exe"]) {
  try { execSync(`taskkill /F /IM "${img}"`, { stdio: "ignore" }) } catch { /* none running */ }
}
// Give the OS a moment to release file locks
execSync(process.platform === "win32" ? "ping -n 3 127.0.0.1 > nul" : "sleep 2", { stdio: "ignore" })

// ── Step 2: clean ───────────────────────────────────────────────────
log("Cleaning previous build output")
for (const dir of [path.join(WEB, ".next"), path.join(WEB, "..", "dist")]) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── Step 2b: ensure the offline STT model + ORT runtime are bundled ──
// Local STT models are not copied into the packaged app.
// Kokoro TTS remains bundled for offline pronunciation models.
log("Skipping bundled local STT models for this executable build")
console.log("  Only Kokoro TTS assets under public/models will be packaged.")

// Offline TTS model (Kokoro) — same idea, so the app can speak with zero network.
log("Ensuring offline TTS voice model (Kokoro) is bundled")
const ttsMarker = path.join(WEB, "public", "models", "onnx-community", "Kokoro-82M-v1.0-ONNX", "onnx", "model_quantized.onnx")
if (!fs.existsSync(ttsMarker)) {
  run("node scripts/fetch-tts-models.mjs")
} else {
  console.log("  ✓ TTS voice model already present")
}

// ── Step 3: better-sqlite3 for system Node ──────────────────────────
log("Rebuilding better-sqlite3 for system Node")
run("npm rebuild better-sqlite3")

// ── Step 4: next build ──────────────────────────────────────────────
log("Building Next.js (standalone output)")
run("next build")

const standaloneServer = path.join(WEB, ".next", "standalone", "server.js")
if (!fs.existsSync(standaloneServer)) {
  console.error("✗ next build did not produce .next/standalone/server.js")
  process.exit(1)
}

// ── Step 5: prepare bundle ──────────────────────────────────────────
log("Preparing standalone bundle (static assets + symlink resolution)")
run("node scripts/prepare-electron-build.mjs")

log("Removing generated local model caches from the package input")
removeGeneratedModelCaches()

// ── Step 6: better-sqlite3 for Electron ─────────────────────────────
log("Rebuilding better-sqlite3 for Electron's ABI")
// Clear electron-gyp cache so it doesn't reuse a wrong-ABI build
const gypCache = path.join(os.homedir(), ".electron-gyp")
fs.rmSync(gypCache, { recursive: true, force: true })
// Remove the stale build dir so the rebuild is from scratch
fs.rmSync(path.join(WEB, "node_modules", "better-sqlite3", "build"), { recursive: true, force: true })
run(`npx @electron/rebuild --version=${ELECTRON_VERSION} --force --only=better-sqlite3`)

// ── Step 7: verify Electron-ABI binary loads ────────────────────────
log("Verifying the Electron-ABI binary loads")
const electronExe = path.join(WEB, "node_modules", "electron", "dist", "electron.exe")
let abiOk = false
try {
  const out = execSync(
    `"${electronExe}" -e "try{require('./node_modules/better-sqlite3');console.log('OK '+process.versions.modules)}catch(e){console.log('FAIL '+e.message)}"`,
    { cwd: WEB, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  ).toString()
  console.log("  " + out.trim())
  abiOk = out.includes("OK 125") // Electron 31 = ABI 125
} catch (e) {
  console.error("  Verification command failed:", e.message)
}
if (!abiOk) {
  console.error("✗ better-sqlite3 is NOT built for Electron's ABI — aborting.")
  process.exit(1)
}

// ── Step 8: electron-builder ────────────────────────────────────────
log("Packaging with electron-builder")
run("npx electron-builder")

// ── Step 9: post-build native module copy ───────────────────────────
log("Copying Electron-ABI binary into the packaged app")
run("node scripts/post-electron-build.mjs")

// ── Step 10: final sanity check ─────────────────────────────────────
log("Final check: packaged binaries")
const distRoot = path.join(WEB, "..", "dist", "win-unpacked")
function findNodeFiles(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) findNodeFiles(p, out)
    else if (e.isFile() && e.name === "better_sqlite3.node") out.push(p)
  }
  return out
}
const found = findNodeFiles(path.join(distRoot, "resources"))
const electronBinSize = fs.statSync(path.join(WEB, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")).size
let allMatch = true
for (const f of found) {
  const size = fs.statSync(f).size
  const ok = size === electronBinSize
  if (!ok) allMatch = false
  console.log(`  ${ok ? "✓" : "✗"} ${path.relative(distRoot, f)} (${size} bytes)`)
}

// ── Step 11: restore Node-ABI binary for the dev server ─────────────
// The packaged app has its own copy of better_sqlite3.node (Electron ABI),
// so we can safely rebuild the source node_modules back to the system-Node
// ABI. This keeps `npm run dev` working after a standalone build.
log("Restoring better-sqlite3 to system-Node ABI (so `npm run dev` keeps working)")
fs.rmSync(path.join(os.homedir(), ".electron-gyp"), { recursive: true, force: true })
run("npm rebuild better-sqlite3")

console.log("")
if (allMatch && found.length > 0) {
  const exe = path.join(distRoot, "Speaking Lab.exe")
  const zip = path.join(WEB, "..", "dist", "SpeakingLab-1.0.0.zip")
  console.log("\x1b[32m✓ Build complete!\x1b[0m")
  console.log(`  App:  ${exe}`)
  if (fs.existsSync(zip)) console.log(`  Zip:  ${zip}`)
  console.log("  (Dev server better-sqlite3 restored to system-Node ABI.)")
} else {
  console.error("\x1b[31m✗ Build finished but native module binaries don't all match the Electron ABI build.\x1b[0m")
  process.exit(1)
}
