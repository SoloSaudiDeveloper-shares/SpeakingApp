"use client"

import { useState, useEffect, useRef } from "react"
import {
  Mic, AlertTriangle, CheckCircle2, XCircle,
  Volume2, Activity, Settings2, Play, Square, Loader2,
  Pause, RotateCcw, Wifi, WifiOff
} from "lucide-react"
import { AudioVisualizer } from "@/components/shared/audio-visualizer"
import { getDefaultEngine, getSpeechEngine, markEngineFailed, OFFLINE_DEFAULT_ENGINE_ID } from "@/lib/speech/speech-factory"
import { TransformersEngine } from "@/lib/speech/transformers-engine"
import { checkWebGPU } from "@/lib/speech/webgpu-check"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { STT_ENGINE_OPTIONS } from "@/lib/speech/types"
import { speak } from "@/lib/speech/tts"
import { cn } from "@/lib/utils/cn"

interface CheckResult {
  name: string
  status: "ok" | "warn" | "fail" | "pending"
  message: string
  fix?: string
}

export default function MicTestPage() {
  const [engineId, setEngineId] = useState<STTEngineId>("web-speech-api")
  const engineRef = useRef<SpeechEngine | null>(null)
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState<string>("")
  const [confidence, setConfidence] = useState<number>(0)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [audioLevel, setAudioLevel] = useState<number>(0)
  const [error, setError] = useState<string>("")
  const [recordingTime, setRecordingTime] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const levelMonitorRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; raf: number } | null>(null)

  // Playback state
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null)
  const [recordedMime, setRecordedMime] = useState<string>("audio/webm")
  const [isPlaying, setIsPlaying] = useState(false)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  // Online status
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true)
  const [hasWebGPU, setHasWebGPU] = useState<boolean | null>(null)

  // Self-test (transcribe known audio)
  const [selfTestRunning, setSelfTestRunning] = useState(false)
  const [selfTestResult, setSelfTestResult] = useState<{ status: "pass" | "fail" | "running"; transcript?: string; expected?: string; error?: string; durationMs?: number } | null>(null)

  const [checks, setChecks] = useState<CheckResult[]>([
    { name: "Internet connection", status: "pending", message: "Checking..." },
    { name: "Browser supports Web Speech API", status: "pending", message: "Checking..." },
    { name: "Browser supports MediaRecorder", status: "pending", message: "Checking..." },
    { name: "Microphone permission", status: "pending", message: "Click 'Test Microphone' to check" },
    { name: "Audio input detected", status: "pending", message: "Speak to test" },
    { name: "Speech recognition produces text", status: "pending", message: "Record and speak to test" },
    { name: "Speaker / TTS works", status: "pending", message: "Click 'Test Speaker' to play sound" },
  ])

  const updateCheck = (name: string, status: CheckResult["status"], message: string, fix?: string) => {
    setChecks((prev) =>
      prev.map((c) => (c.name === name ? { ...c, status, message, fix } : c))
    )
  }

  // Initial capability checks
  useEffect(() => {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null
    if (saved) setEngineId(saved)
    engineRef.current = saved ? getSpeechEngine(saved) : getDefaultEngine()

    const handleOnline = () => { setOnline(true); updateCheck("Internet connection", "ok", "Online — Web Speech API will work") }
    const handleOffline = () => { setOnline(false); updateCheck("Internet connection", "warn", "Offline — Web Speech API won't work, but offline engines will (if WebGPU is supported)") }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    if (navigator.onLine) handleOnline(); else handleOffline()

    // Check WebGPU support (needed for offline engines)
    checkWebGPU().then((ok) => setHasWebGPU(ok))

    const win = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
    const hasSpeech = !!(win.SpeechRecognition || win.webkitSpeechRecognition)
    updateCheck(
      "Browser supports Web Speech API",
      hasSpeech ? "ok" : "warn",
      hasSpeech ? "Yes — your browser supports Web Speech API" : "Not available. Use Chrome or Edge for online speech recognition.",
      hasSpeech ? undefined : "Use Google Chrome or Microsoft Edge."
    )

    const hasMR = typeof MediaRecorder !== "undefined"
    updateCheck(
      "Browser supports MediaRecorder",
      hasMR ? "ok" : "fail",
      hasMR ? "Yes — MediaRecorder API is available" : "Not supported in your browser",
      hasMR ? undefined : "Update your browser to a recent version of Chrome, Edge, or Firefox."
    )

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Audio level monitor
  useEffect(() => {
    if (!micStream) {
      if (levelMonitorRef.current) {
        cancelAnimationFrame(levelMonitorRef.current.raf)
        levelMonitorRef.current.ctx.close().catch(() => {})
        levelMonitorRef.current = null
      }
      setAudioLevel(0)
      return
    }

    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(micStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const buffer = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    let peakLevel = 0

    const tick = () => {
      analyser.getByteFrequencyData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) sum += buffer[i]
      const avg = sum / buffer.length
      const normalized = Math.min(1, avg / 60)
      setAudioLevel(normalized)
      if (normalized > peakLevel) peakLevel = normalized
      if (normalized > 0.05) {
        updateCheck("Audio input detected", "ok", `Audio level peak: ${Math.round(peakLevel * 100)}%`)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    levelMonitorRef.current = { ctx, analyser, raf }

    return () => {
      cancelAnimationFrame(raf)
      ctx.close().catch(() => {})
    }
  }, [micStream])

  const handleTestSpeaker = async () => {
    try {
      await speak("Hello, this is a test. Can you hear me?")
      updateCheck("Speaker / TTS works", "ok", "Audio played successfully — did you hear it?")
    } catch (e) {
      updateCheck(
        "Speaker / TTS works",
        "fail",
        e instanceof Error ? e.message : "Failed to play audio",
        "Check your speaker volume and browser audio permissions."
      )
    }
  }

  const startParallelRecording = (stream: MediaStream) => {
    recordedChunksRef.current = []
    const mimeOptions = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""]
    let mr: MediaRecorder | null = null
    for (const m of mimeOptions) {
      try {
        mr = m ? new MediaRecorder(stream, { mimeType: m }) : new MediaRecorder(stream)
        if (m) setRecordedMime(m)
        else setRecordedMime(mr.mimeType || "audio/webm")
        break
      } catch {
        /* try next */
      }
    }
    if (!mr) return
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data)
    }
    mr.start(200)
    mediaRecorderRef.current = mr
  }

  const stopParallelRecording = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current
      if (!mr || mr.state === "inactive") {
        resolve(null)
        return
      }
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recordedMime })
        recordedChunksRef.current = []
        if (blob.size === 0) {
          resolve(null)
          return
        }
        const url = URL.createObjectURL(blob)
        resolve(url)
      }
      try { mr.stop() } catch { resolve(null) }
      mediaRecorderRef.current = null
    })
  }

  const handleStart = async () => {
    setError(""); setTranscript(""); setConfidence(0); setRecordingTime(0)
    setErrorCode(null); setErrorMessage(null)
    if (recordedBlobUrl) {
      URL.revokeObjectURL(recordedBlobUrl)
      setRecordedBlobUrl(null)
    }
    updateCheck("Microphone permission", "pending", "Requesting access...")

    try {
      if (!engineRef.current) engineRef.current = getDefaultEngine()
      await engineRef.current.start()
      const stream = engineRef.current.getStream()
      setMicStream(stream)
      setRecording(true)

      // Start a parallel MediaRecorder to capture audio for playback
      if (stream) startParallelRecording(stream)

      updateCheck("Microphone permission", "ok", "Microphone access granted ✓")

      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)

      // If the offline (WebAI) engine couldn't load, mark all WebAI
      // engines failed and auto-switch to Web Speech API.
      const isWebAIError = msg.includes("speech model") || msg.includes("WebGPU") || msg.includes("offline") || msg.includes("initialization_failed")
      if (engineId !== "web-speech-api" && isWebAIError) {
        markEngineFailed(engineId)
        setHasWebGPU(false)
        handleSwitchEngine("web-speech-api")
        updateCheck(
          "Microphone permission",
          "warn",
          "Switched to Web Speech API — the offline engine couldn't load on this device.",
        )
      } else {
        updateCheck(
          "Microphone permission",
          "fail",
          msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")
            ? "Permission denied. Click the mic icon in your browser address bar to allow."
            : msg,
          "1. Click the camera/mic icon in your browser's address bar.\n2. Set Microphone to 'Allow'.\n3. Reload this page."
        )
      }
    }
  }

  const handleStop = async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (!engineRef.current) return
    setRecording(false)

    // Stop the parallel recorder first to capture final chunks
    const audioUrl = await stopParallelRecording()
    if (audioUrl) setRecordedBlobUrl(audioUrl)

    try {
      const result = await engineRef.current.stop()
      setMicStream(null)
      setTranscript(result.transcript || "")
      setConfidence(result.confidence || 0)
      setErrorCode(result.errorCode ?? null)
      setErrorMessage(result.errorMessage ?? null)

      if (result.transcript && result.transcript.trim().length > 0) {
        updateCheck(
          "Speech recognition produces text",
          "ok",
          `Recognized: "${result.transcript}" (confidence: ${Math.round((result.confidence || 0) * 100)}%)`
        )
      } else if (result.errorCode === "network") {
        updateCheck(
          "Speech recognition produces text",
          "fail",
          result.errorMessage ?? "Network error",
          "1. Check your internet connection.\n2. Try the offline Whisper or Moonshine engines (if your device supports WebGPU).\n3. The audio file you just recorded can be played back below to verify your microphone is working correctly."
        )
      } else if (result.errorCode === "no-speech") {
        updateCheck(
          "Speech recognition produces text",
          "warn",
          result.errorMessage ?? "No speech detected",
          "1. Speak louder, closer to the mic.\n2. Make sure your mic isn't muted in your OS.\n3. Play back the recording below — if you hear yourself, the issue is the recognition engine, not the mic."
        )
      } else {
        updateCheck(
          "Speech recognition produces text",
          "warn",
          result.errorMessage ?? "No transcript was returned.",
          "1. Try a different STT engine below.\n2. Speak louder and clearer.\n3. Play back the recording below to verify your audio was captured."
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      updateCheck("Speech recognition produces text", "fail", msg)
    }
  }

  const handleSwitchEngine = (id: STTEngineId) => {
    setEngineId(id)
    engineRef.current = getSpeechEngine(id)
    localStorage.setItem("stt-engine", id)
    setTranscript("")
    setConfidence(0)
    setErrorCode(null)
    setErrorMessage(null)
  }

  const handlePlayback = () => {
    const audio = audioElRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      audio.currentTime = 0
      audio.play().catch(() => {})
    }
  }

  const handleSelfTest = async () => {
    setSelfTestRunning(true)
    setSelfTestResult({ status: "running" })
    const start = Date.now()
    try {
      // 1. Fetch the test audio
      const res = await fetch("/api/dev/test-audio")
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error("You must be signed in to run the self-test.")
        throw new Error(`Test audio not found (${res.status}). Run scripts/test-transformers-stt.mjs first to populate the cache.`)
      }
      const blob = await res.blob()

      // 2. Decode to 16 kHz mono Float32
      const buf = await blob.arrayBuffer()
      const ctx = new AudioContext({ sampleRate: 16000 })
      const audio = await ctx.decodeAudioData(buf)
      const float32 = audio.getChannelData(0)
      ctx.close()

      // 3. Run through the bundled offline engine (the app's real default)
      const engine = new TransformersEngine(OFFLINE_DEFAULT_ENGINE_ID)
      const transcript = await engine.transcribeBuffer(float32)

      // 4. Verify against expected keywords
      const expected = "ask not what your country can do for you"
      const match = transcript.toLowerCase().includes(expected)

      setSelfTestResult({
        status: match ? "pass" : "fail",
        transcript,
        expected,
        durationMs: Date.now() - start,
        error: match ? undefined : "Expected phrase not found in transcript.",
      })
    } catch (e) {
      setSelfTestResult({
        status: "fail",
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      })
    } finally {
      setSelfTestRunning(false)
    }
  }

  const handleResetRecording = () => {
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl)
    setRecordedBlobUrl(null)
    setTranscript("")
    setConfidence(0)
    setErrorCode(null)
    setErrorMessage(null)
  }

  const allOk = checks.every((c) => c.status === "ok")
  const anyFail = checks.some((c) => c.status === "fail")
  const currentEngine = STT_ENGINE_OPTIONS.find((o) => o.id === engineId)

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Settings2 className="text-primary" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Microphone Test</h1>
          <p className="text-sm text-muted-foreground">
            Diagnose your microphone, speaker, and speech recognition setup.
          </p>
        </div>
      </div>

      {/* Online indicator */}
      <div className={cn(
        "mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
        online ? "border-green-500/30 bg-green-500/10 text-green-500" : "border-amber-500/30 bg-amber-500/10 text-amber-500"
      )}>
        {online ? <Wifi size={16} /> : <WifiOff size={16} />}
        <span>
          {online
            ? "You're online — Web Speech API will work."
            : "You're offline — Web Speech API won't work. Use offline Whisper/Moonshine engines instead."
          }
        </span>
      </div>

      {/* Overall status */}
      <div
        className={cn(
          "mb-6 rounded-lg border p-4",
          allOk
            ? "border-green-500/30 bg-green-500/10"
            : anyFail
              ? "border-red-500/30 bg-red-500/10"
              : "border-amber-500/30 bg-amber-500/10"
        )}
      >
        <div className="flex items-center gap-2">
          {allOk ? (
            <CheckCircle2 className="text-green-500" size={20} />
          ) : anyFail ? (
            <XCircle className="text-red-500" size={20} />
          ) : (
            <AlertTriangle className="text-amber-500" size={20} />
          )}
          <span className="font-semibold">
            {allOk
              ? "All checks passed — you're good to go!"
              : anyFail
                ? "Some checks failed — see details below"
                : "Run the tests below to verify your setup"}
          </span>
        </div>
      </div>

      {/* Test controls */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {/* Mic test */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
            <Mic size={16} /> Microphone
          </h2>
          {recording ? (
            <button
              onClick={handleStop}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-red-500 px-4 py-3 font-medium text-white transition hover:bg-red-600"
            >
              <Square size={16} /> Stop ({recordingTime}s)
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Mic size={16} /> Test Microphone
            </button>
          )}

          {/* Audio level meter */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Audio level</span>
              <span>{Math.round(audioLevel * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-gradient-to-r from-green-500 via-amber-500 to-red-500 transition-[width] duration-75"
                style={{ width: `${Math.round(audioLevel * 100)}%` }}
              />
            </div>
          </div>

          {micStream && (
            <div className="mt-3">
              <AudioVisualizer stream={micStream} isRecording={recording} />
            </div>
          )}

          {/* Playback */}
          {recordedBlobUrl && (
            <div className="mt-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-500">Recorded audio</h3>
                <button
                  onClick={handleResetRecording}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  title="Clear recording"
                >
                  <RotateCcw size={12} /> Clear
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePlayback}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                </button>
                <audio
                  ref={audioElRef}
                  src={recordedBlobUrl}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  controls
                  className="flex-1 h-10"
                />
              </div>
              <p className="text-[0.7rem] text-muted-foreground">
                Play this back to verify your microphone is actually capturing your voice. If you hear yourself clearly, the mic works fine — any &quot;no transcript&quot; error is the recognition engine, not the mic.
              </p>
            </div>
          )}

          {transcript && (
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Transcript:</div>
              <div className="mt-1 font-mono">{transcript}</div>
              {confidence > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Confidence: {Math.round(confidence * 100)}%
                </div>
              )}
            </div>
          )}

          {!transcript && errorMessage && !recording && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <div className="font-semibold text-amber-500 mb-1">Recognition error: {errorCode}</div>
              <div className="text-foreground/90 whitespace-pre-line">{errorMessage}</div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}
        </div>

        {/* Speaker test */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
            <Volume2 size={16} /> Speaker
          </h2>
          <button
            onClick={handleTestSpeaker}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Play size={16} /> Test Speaker
          </button>
          <p className="mt-3 text-xs text-muted-foreground">
            A short phrase will be spoken. If you don&apos;t hear it, check your volume and browser audio settings.
          </p>
        </div>
      </div>

      {/* Self-test (transcribe known audio) */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
          <CheckCircle2 size={16} /> Self-Test (Whisper offline model)
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Runs the bundled offline Whisper model on a known audio sample (JFK&apos;s &ldquo;ask not what your country&rdquo; speech)
          and verifies the transcript is correct. No microphone or internet needed — this proves the offline engine works on this device.
        </p>
        <button
          onClick={handleSelfTest}
          disabled={selfTestRunning}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {selfTestRunning ? <><Loader2 size={14} className="animate-spin" /> Testing... (loading bundled model)</> : <><Play size={14} /> Run Self-Test</>}
        </button>

        {selfTestResult && (
          <div className={cn(
            "mt-3 rounded-md border p-3 text-sm",
            selfTestResult.status === "pass" ? "border-green-500/30 bg-green-500/10" :
            selfTestResult.status === "fail" ? "border-red-500/30 bg-red-500/10" :
            "border-amber-500/30 bg-amber-500/10"
          )}>
            <div className="flex items-center gap-2 font-semibold">
              {selfTestResult.status === "pass" && <><CheckCircle2 size={16} className="text-green-500" /> <span className="text-green-500">PASS</span></>}
              {selfTestResult.status === "fail" && <><XCircle size={16} className="text-red-500" /> <span className="text-red-500">FAIL</span></>}
              {selfTestResult.status === "running" && <><Loader2 size={16} className="animate-spin text-amber-500" /> <span className="text-amber-500">Running...</span></>}
              {selfTestResult.durationMs && (
                <span className="text-xs text-muted-foreground ml-auto">{(selfTestResult.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>
            {selfTestResult.transcript && (
              <div className="mt-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Transcript:</span>
                <div className="mt-0.5 font-mono text-xs bg-muted/50 p-2 rounded">{selfTestResult.transcript}</div>
              </div>
            )}
            {selfTestResult.expected && (
              <div className="mt-2 text-xs text-muted-foreground">
                Expected to contain: <code className="bg-muted/50 px-1 rounded">{selfTestResult.expected}</code>
              </div>
            )}
            {selfTestResult.error && (
              <div className="mt-2 text-xs text-red-500">{selfTestResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Engine picker */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Activity size={16} /> Speech Recognition Engine
          </h2>
          {currentEngine && (
            <span className="text-xs text-muted-foreground">
              Current: <strong className="text-foreground">{currentEngine.name}</strong>
              {" · "}
              <span className={currentEngine.offline ? "text-blue-500" : "text-green-500"}>
                {currentEngine.offline ? "offline" : "online (needs internet)"}
              </span>
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          If one engine doesn&apos;t work, try switching to another.
        </p>
        <div className="mb-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-600 dark:text-blue-400">
          <strong>Offline Whisper is the default</strong> and is bundled with the app — it runs locally on the CPU (WASM), needs no internet, and works inside the Windows app. Web Speech API is online-only and won&apos;t work in the packaged app.
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {STT_ENGINE_OPTIONS.map((opt) => {
            // Offline engines run on WASM (no WebGPU needed), so nothing here is
            // hard-disabled; Web Speech simply needs internet at runtime.
            const disabled = false
            return (
              <button
                key={opt.id}
                onClick={() => !disabled && handleSwitchEngine(opt.id)}
                disabled={disabled}
                className={cn(
                  "rounded-md border p-3 text-left transition",
                  disabled
                    ? "border-border bg-muted/30 cursor-not-allowed opacity-50"
                    : engineId === opt.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                )}
                title={disabled ? "Requires WebGPU (not supported on this device)" : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-sm font-medium", engineId === opt.id && !disabled ? "text-primary" : "text-foreground")}>
                    {opt.name}
                  </span>
                  {disabled ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-muted-foreground">
                      Unavailable
                    </span>
                  ) : opt.offline ? (
                    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-blue-500">
                      Offline
                    </span>
                  ) : opt.compute === "Download required" ? (
                    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-blue-500">
                      Download
                    </span>
                  ) : (
                    <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-green-500">
                      Online
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[0.7rem] text-muted-foreground">
                  {opt.quality} · {opt.speed} · {opt.size}
                  {disabled && " · needs WebGPU"}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Check list */}
      <div className="rounded-lg border border-border bg-card">
        <h2 className="border-b border-border p-4 font-semibold text-foreground">
          Diagnostic Checks
        </h2>
        <ul className="divide-y divide-border">
          {checks.map((c) => (
            <li key={c.name} className="p-4">
              <div className="flex items-start gap-3">
                {c.status === "ok" && <CheckCircle2 className="mt-0.5 shrink-0 text-green-500" size={18} />}
                {c.status === "fail" && <XCircle className="mt-0.5 shrink-0 text-red-500" size={18} />}
                {c.status === "warn" && <AlertTriangle className="mt-0.5 shrink-0 text-amber-500" size={18} />}
                {c.status === "pending" && <Loader2 className="mt-0.5 shrink-0 text-muted-foreground animate-spin" size={18} />}
                <div className="flex-1">
                  <div className="font-medium text-foreground">{c.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{c.message}</div>
                  {c.fix && (
                    <div className="mt-2 whitespace-pre-line rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                      💡 {c.fix}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
