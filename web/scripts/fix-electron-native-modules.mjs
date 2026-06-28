// After electron-builder runs, the standalone bundle inside the packaged app
// still contains better-sqlite3 compiled for system Node. We need to replace
// it with the Electron-ABI build that lives in node_modules/better-sqlite3.
//
// Specifically, we copy build/Release/better_sqlite3.node from
//   node_modules/better-sqlite3
// to
//   dist/win-unpacked/resources/app/.next/standalone/node_modules/better-sqlite3
//
// Run after `electron-builder` finishes.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, "..")
const DIST_DIR = path.join(WEB_DIR, "..", "dist", "win-unpacked")

const SRC = path.join(
  WEB_DIR,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
)
const DST = path.join(
  DIST_DIR,
  "resources",
  "app",
  ".next",
  "standalone",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
)

if (!fs.existsSync(SRC)) {
  console.error(`[fix-native] Source missing: ${SRC}`)
  process.exit(1)
}
if (!fs.existsSync(path.dirname(DST))) {
  console.error(`[fix-native] Destination dir missing: ${path.dirname(DST)}`)
  process.exit(1)
}

const srcSize = fs.statSync(SRC).size
const dstSize = fs.existsSync(DST) ? fs.statSync(DST).size : 0
fs.copyFileSync(SRC, DST)
console.log(`[fix-native] Replaced better_sqlite3.node`)
console.log(`  src: ${SRC} (${srcSize} bytes)`)
console.log(`  dst: ${DST} (was ${dstSize}, now ${srcSize})`)
