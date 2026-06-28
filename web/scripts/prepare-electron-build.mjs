// Prep step run between `next build` and `electron-builder`.
//
// 1. Mirror .next/static and public/ into the standalone tree so the bundled
//    server can serve static assets.
// 2. Ensure better-sqlite3 lives inside the standalone bundle's node_modules
//    so the packaged app doesn't try to load from the absolute dev path.
// 3. Resolve ALL symlinks inside .next/standalone — Next.js uses symlinks
//    to the source node_modules during tracing, and those break once we
//    package and ship to a different machine.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, "..")

const STANDALONE = path.join(WEB_DIR, ".next", "standalone")
const STATIC_SRC = path.join(WEB_DIR, ".next", "static")
const STATIC_DST = path.join(STANDALONE, ".next", "static")
const PUBLIC_SRC = path.join(WEB_DIR, "public")
const PUBLIC_DST = path.join(STANDALONE, "public")

const STANDALONE_NM = path.join(STANDALONE, "node_modules")
const KOKORO_MODEL_ROOT = path.join(
  PUBLIC_SRC,
  "models",
  "onnx-community",
  "Kokoro-82M-v1.0-ONNX",
)

function shouldCopyPublicPath(src) {
  if (!src.startsWith(PUBLIC_SRC)) return true
  const rel = path.relative(PUBLIC_SRC, src)
  if (!rel || rel === "") return true
  const parts = rel.split(path.sep)
  if (parts[0] !== "models") return true

  return (
    src === KOKORO_MODEL_ROOT ||
    src.startsWith(KOKORO_MODEL_ROOT + path.sep) ||
    KOKORO_MODEL_ROOT.startsWith(src + path.sep)
  )
}

function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) {
    console.warn(`[prepare] Skipping (source missing): ${src}`)
    return
  }
  if (!filter(src)) return
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (!filter(s)) continue
    if (entry.isSymbolicLink()) {
      // Resolve symlinks to real directory copies
      try {
        const real = fs.realpathSync(s)
        const st = fs.statSync(real)
        if (st.isDirectory()) {
          copyDir(real, d, filter)
        } else {
          fs.copyFileSync(real, d)
        }
      } catch (e) {
        console.warn(`[prepare] Could not resolve symlink ${s}: ${e.message}`)
      }
    } else if (entry.isDirectory()) {
      copyDir(s, d, filter)
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d)
    }
  }
}

function ensureModule(name) {
  const src = path.join(WEB_DIR, "node_modules", name)
  const dst = path.join(STANDALONE_NM, name)
  if (!fs.existsSync(src)) {
    console.warn(`[prepare] Skipping (module missing in node_modules): ${name}`)
    return
  }
  if (fs.existsSync(dst)) {
    console.log(`[prepare] ${name} already in standalone bundle`)
    return
  }
  copyDir(src, dst)
  console.log(`[prepare] Copied ${name} into standalone bundle`)
}

/** Walk the entire standalone tree and replace every symlink with a real copy. */
function resolveSymlinks(root) {
  if (!fs.existsSync(root)) return
  const stack = [root]
  let replaced = 0
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(p)
          const st = fs.statSync(real)
          // Windows directory symlinks/junctions: use rmdirSync (not rmSync
          // which complains "Path is a directory") then copy.
          // File symlinks: use unlinkSync.
          if (st.isDirectory()) {
            try { fs.rmdirSync(p) } catch { fs.unlinkSync(p) }
            copyDir(real, p)
          } else {
            fs.unlinkSync(p)
            fs.copyFileSync(real, p)
          }
          replaced++
        } catch (err) {
          console.warn(`[prepare] Could not resolve ${p}: ${err.message}`)
        }
      } else if (e.isDirectory()) {
        stack.push(p)
      }
    }
  }
  if (replaced > 0) {
    console.log(`[prepare] Replaced ${replaced} symlinks with real copies in ${path.relative(WEB_DIR, root)}`)
  }
}

console.log("[prepare] Mirroring static assets into the standalone bundle")
copyDir(STATIC_SRC, STATIC_DST)
fs.rmSync(PUBLIC_DST, { recursive: true, force: true })
copyDir(PUBLIC_SRC, PUBLIC_DST, shouldCopyPublicPath)

console.log("[prepare] Ensuring required native modules are in standalone/node_modules")
fs.mkdirSync(STANDALONE_NM, { recursive: true })
ensureModule("better-sqlite3")
ensureModule("bindings")
ensureModule("file-uri-to-path")

console.log("[prepare] Resolving symlinks in the standalone bundle")
resolveSymlinks(STANDALONE)

console.log("[prepare] Done.")
