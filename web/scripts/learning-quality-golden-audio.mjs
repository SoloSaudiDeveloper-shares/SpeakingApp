import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wav from "wavefile";
import { pipeline } from "@huggingface/transformers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, "..");
const ROOT = path.join(WEB, "..");
const outDir = path.join(ROOT, "outputs", "deep-qa");
const audioDir = path.join(ROOT, "outputs", "golden-audio");
const reportPath = path.join(outDir, "golden-audio-results.json");
const JFK_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(audioDir, { recursive: true });

function writeWav(filePath, samples, sampleRate = 16000) {
  const wf = new wav.WaveFile();
  wf.fromScratch(1, sampleRate, "32f", samples);
  wf.toBitDepth("16");
  fssync.writeFileSync(filePath, wf.toBuffer());
}

function loadWavAsFloat32(filePath) {
  const buffer = fssync.readFileSync(filePath);
  const wf = new wav.WaveFile(buffer);
  wf.toBitDepth("32f");
  wf.toSampleRate(16000);
  let samples = wf.getSamples();
  if (Array.isArray(samples)) {
    const left = samples[0];
    const right = samples[1] ?? samples[0];
    const out = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2;
    samples = out;
  }
  return samples;
}

async function download(url, filePath) {
  if (fssync.existsSync(filePath)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  await fs.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
}

function synthesizeWithWindowsSpeech(items) {
  const ps = [
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$s.Rate = 0",
    "$s.Volume = 100",
    ...items.flatMap((item) => [
      `$s.SetOutputToWaveFile(${JSON.stringify(item.path)})`,
      `$s.Speak(${JSON.stringify(item.text)})`,
      "$s.SetOutputToNull()",
    ]),
    "$s.Dispose()",
  ].join("\n");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: "pipe" });
}

const fixtures = [
  {
    id: "jfk-public",
    text: "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.",
    expectedKeywords: ["ask not what your country", "what you can do for your country"],
    source: JFK_URL,
    path: path.join(audioDir, "jfk.wav"),
    type: "public-known-speech",
  },
  {
    id: "water-tts",
    text: "water",
    expectedKeywords: ["water"],
    path: path.join(audioDir, "water.wav"),
    type: "synthetic-clear",
  },
  {
    id: "glass-water-tts",
    text: "I need a glass of water",
    expectedKeywords: ["need", "glass", "water"],
    path: path.join(audioDir, "glass-of-water.wav"),
    type: "synthetic-clear",
  },
  {
    id: "large-coffee-tts",
    text: "Can I have a large coffee please",
    expectedKeywords: ["large", "coffee", "please"],
    path: path.join(audioDir, "large-coffee.wav"),
    type: "synthetic-clear",
  },
  {
    id: "repeated-yes-tts",
    text: "yes yes yes yes yes yes yes yes",
    expectedKeywords: ["yes"],
    path: path.join(audioDir, "repeated-yes.wav"),
    type: "anti-cheat",
  },
  {
    id: "silence",
    text: "",
    expectedKeywords: [],
    path: path.join(audioDir, "silence.wav"),
    type: "silence",
  },
  {
    id: "low-noise",
    text: "",
    expectedKeywords: [],
    path: path.join(audioDir, "low-noise.wav"),
    type: "noise",
  },
];

await download(JFK_URL, fixtures[0].path);
synthesizeWithWindowsSpeech(fixtures.filter((f) => f.type === "synthetic-clear" || f.type === "anti-cheat"));

const silence = new Float32Array(16000 * 2);
writeWav(fixtures.find((f) => f.id === "silence").path, silence);
const noise = new Float32Array(16000 * 2);
let seed = 42;
for (let i = 0; i < noise.length; i++) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  noise[i] = (((seed / 0xffffffff) * 2) - 1) * 0.002;
}
writeWav(fixtures.find((f) => f.id === "low-noise").path, noise);

function transcriptCheck(text, fixture) {
  const lower = text.toLowerCase();
  const words = (lower.match(/[a-z']+/g) ?? []).filter(Boolean);
  if (fixture.type === "silence" || fixture.type === "noise") {
    return {
      ok: words.length <= 2,
      matched: [],
      missing: [],
      reason: `nonSpeechWords=${words.length}`,
    };
  }
  const matched = fixture.expectedKeywords.filter((keyword) => lower.includes(keyword));
  const missing = fixture.expectedKeywords.filter((keyword) => !lower.includes(keyword));
  return { ok: missing.length === 0, matched, missing, reason: `${matched.length}/${fixture.expectedKeywords.length}` };
}

async function localWhisper() {
  const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
  const results = [];
  for (const fixture of fixtures) {
    const started = Date.now();
    let text = "";
    let error = null;
    try {
      const audio = loadWavAsFloat32(fixture.path);
      const result = await transcriber(audio);
      text = (result?.text ?? result?.transcription ?? "").trim();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const check = transcriptCheck(text, fixture);
    results.push({
      engine: "local-whisper-tiny",
      fixture: fixture.id,
      type: fixture.type,
      expected: fixture.text,
      transcript: text,
      ok: !error && check.ok,
      check,
      error,
      ms: Date.now() - started,
    });
  }
  return results;
}

async function login(base) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "1", password: "1" }),
  });
  return res.headers.get("set-cookie")?.match(/session-token=[^;]+/)?.[0] || "";
}

async function cloudGroq(base) {
  const results = [];
  let cookie = "";
  try {
    cookie = await login(base);
  } catch (e) {
    return fixtures.map((fixture) => ({
      engine: "cloud-groq",
      fixture: fixture.id,
      type: fixture.type,
      ok: false,
      skipped: true,
      error: `login failed: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }

  for (const fixture of fixtures) {
    const started = Date.now();
    let status = "NETWORK";
    let data = null;
    let error = null;
    try {
      const form = new FormData();
      const bytes = await fs.readFile(fixture.path);
      form.append("file", new Blob([bytes], { type: "audio/wav" }), path.basename(fixture.path));
      const res = await fetch(`${base}/api/stt/transcribe`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const transcript = String(data?.transcript ?? "").trim();
    const check = transcriptCheck(transcript, fixture);
    const configuredMissing = status === 503 && data?.error === "no-key";
    results.push({
      engine: "cloud-groq",
      fixture: fixture.id,
      type: fixture.type,
      expected: fixture.text,
      transcript,
      ok: !error && (status === 200 ? check.ok : configuredMissing),
      status,
      check,
      error,
      ms: Date.now() - started,
    });
  }
  return results;
}

const results = [
  ...(await localWhisper()),
  ...(await cloudGroq("http://localhost:3000")),
  ...(await cloudGroq("http://localhost:3010")),
];

const failures = results.filter((row) => !row.ok);
await fs.writeFile(reportPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  fixtures: fixtures.map((f) => ({ id: f.id, type: f.type, text: f.text, path: f.path, expectedKeywords: f.expectedKeywords })),
  total: results.length,
  failureCount: failures.length,
  failures,
  results,
}, null, 2));

console.log(JSON.stringify({
  reportPath,
  total: results.length,
  failureCount: failures.length,
  engines: [...new Set(results.map((r) => r.engine))],
}, null, 2));

if (failures.length) {
  for (const failure of failures) {
    console.log(`${failure.engine} ${failure.fixture}: ${failure.status ?? ""} ${failure.transcript ?? failure.error}`);
  }
  process.exitCode = 1;
}
