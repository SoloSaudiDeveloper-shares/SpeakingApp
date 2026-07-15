import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const dataDir = process.env.SPEAKING_LAB_DATA_DIR
  ? path.resolve(process.env.SPEAKING_LAB_DATA_DIR)
  : path.resolve(process.cwd(), "..", "data")
const sourcePath = path.join(dataDir, "speakinglab.db")
const backupDir = path.join(dataDir, "backups")

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")))
  })
}

function integrity(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.pragma("integrity_check")
    const tables = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get().count
    if (rows.length !== 1 || rows[0].integrity_check !== "ok") throw new Error(`Integrity check failed: ${JSON.stringify(rows)}`)
    return { integrity: "ok", tables }
  } finally {
    db.close()
  }
}

function filesUnder(root) {
  if (!existsSync(root)) return []
  const output = []
  for (const name of readdirSync(root)) {
    const full = path.join(root, name)
    const stat = statSync(full)
    if (stat.isDirectory()) output.push(...filesUnder(full))
    else output.push({ path: path.relative(dataDir, full).replaceAll("\\", "/"), size: stat.size, modifiedAt: stat.mtime.toISOString(), full })
  }
  return output
}

async function restoreTest() {
  const requestedPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"))
  let backupPath
  if (requestedPath) {
    backupPath = path.resolve(requestedPath)
    if (!existsSync(backupPath)) throw new Error(`Backup not found at ${backupPath}`)
  } else {
    if (!existsSync(backupDir)) throw new Error(`No backup directory at ${backupDir}`)
    const candidates = readdirSync(backupDir).filter((name) => name.endsWith(".db")).sort().reverse()
    if (!candidates.length) throw new Error("No SQLite backups found.")
    backupPath = path.join(backupDir, candidates[0])
  }
  console.log(JSON.stringify({ mode: "restore-test", backupPath, ...integrity(backupPath), sha256: await sha256(backupPath) }, null, 2))
}

if (process.argv.includes("--restore-test-only")) {
  await restoreTest()
  process.exit(0)
}

if (!existsSync(sourcePath)) throw new Error(`Database not found at ${sourcePath}`)
mkdirSync(backupDir, { recursive: true })
const stamp = timestamp()
const backupPath = path.join(backupDir, `speakinglab-${stamp}.db`)
const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
try {
  integrity(sourcePath)
  await source.backup(backupPath)
} finally {
  source.close()
}

const audioRoots = [path.join(dataDir, "audio"), path.resolve(process.cwd(), "..", "audio-archive")]
const audioFiles = audioRoots.flatMap(filesUnder)
const audioManifest = []
for (const file of audioFiles) {
  audioManifest.push({ path: file.path, size: file.size, modifiedAt: file.modifiedAt, sha256: await sha256(file.full) })
}
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourcePath,
  backupPath,
  database: { ...integrity(backupPath), size: statSync(backupPath).size, sha256: await sha256(backupPath) },
  audio: { count: audioManifest.length, files: audioManifest },
}
const manifestPath = `${backupPath}.manifest.json`
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(JSON.stringify({ backupPath, manifestPath, database: manifest.database, audioFiles: manifest.audio.count }, null, 2))
