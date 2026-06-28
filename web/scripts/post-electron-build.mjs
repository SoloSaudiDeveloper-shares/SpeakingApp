// After electron-builder finishes, replace the better-sqlite3 native binary
// inside the packaged standalone bundle with the Electron-ABI build that
// electron-builder produced in node_modules/better-sqlite3.
//
// This way the bundled server (which loads better-sqlite3 via standalone
// node_modules) gets the right binary for Electron's V8.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, "..")
const DIST = path.join(WEB_DIR, "..", "dist", "win-unpacked")

// The Electron-ABI binary lives in web/node_modules — @electron/rebuild placed
// it there. electron-builder's copy of dist/resources/app/node_modules is the
// pre-electron-builder snapshot, which is the Node-ABI version. We want the
// post-rebuild one.
const SRC = path.join(WEB_DIR, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")

if (!fs.existsSync(DIST)) {
  console.error(`[post-build] dist/win-unpacked missing — did electron-builder fail?`)
  process.exit(1)
}
if (!fs.existsSync(SRC)) {
  console.error(`[post-build] Source binary missing: ${SRC}`)
  process.exit(1)
}

const srcSize = fs.statSync(SRC).size

// Find every better_sqlite3.node in the packaged tree and replace it.
function findAllNodeFiles(root) {
  const out = []
  if (!fs.existsSync(root)) return out
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && e.name === "better_sqlite3.node") out.push(p)
    }
  }
  return out
}

const targets = findAllNodeFiles(path.join(DIST, "resources"))
if (targets.length === 0) {
  console.warn("[post-build] No better_sqlite3.node files found in packaged tree.")
} else {
  for (const t of targets) {
    const dstSize = fs.statSync(t).size
    fs.copyFileSync(SRC, t)
    console.log(`[post-build] ${srcSize} bytes (was ${dstSize}) → ${t}`)
  }
}

console.log("[post-build] Done.")
