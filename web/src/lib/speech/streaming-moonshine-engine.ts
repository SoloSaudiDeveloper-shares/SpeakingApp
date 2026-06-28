"use client"

import type { SpeechEngine, SpeechRecognitionResult, STTEngineId } from "./types"

/**
 * Streaming speech-to-text engine: Silero VAD + Moonshine.
 *
 * Adapted from Hugging Face's official transformers.js-examples/moonshine-web
 * reference implementation. Runs entirely in the main thread (no Web Worker)
 * for simpler bundling — Transformers.js inference still uses a worker
 * internally for ONNX Runtime.
 *
 * Pipeline:
 *   1. AudioWorklet captures raw 16 kHz Float32 frames (~128 samples each)
 *   2. Frames are accumulated into 512-sample chunks
 *   3. Each chunk is fed to Silero VAD; speech start/end is detected via
 *      probability thresholds
 *   4. On speech end (silence > 400ms), the buffered audio is sent to
 *      Moonshine for transcription
 *   5. The transcript fragment is emitted via the onInterim() callback
 *
 * Final stop() returns the concatenation of all fragments.
 */

const SAMPLE_RATE = 16000
const SPEECH_THRESHOLD = 0.3
const EXIT_THRESHOLD = 0.1
const MIN_SILENCE_DURATION_SAMPLES = 24000 // 1500ms — long enough that brief mid-sentence pauses don't trigger a segment cut
const SPEECH_PAD_SAMPLES = 1280 // 80ms
const MIN_SPEECH_DURATION_SAMPLES = 4000 // 250ms
const MAX_BUFFER_DURATION = 30 // seconds
const VAD_CHUNK_SIZE = 512 // Silero VAD expects 512 samples per call at 16kHz
const MAX_NUM_PREV_BUFFERS = Math.ceil(SPEECH_PAD_SAMPLES / VAD_CHUNK_SIZE)

const ENGINE_TO_MODEL: Partial<Record<STTEngineId, string>> = {
  "webai-moonshine-tiny": "onnx-community/moonshine-tiny-ONNX",
  "webai-moonshine-base": "onnx-community/moonshine-base-ONNX",
}

// Singleton model cache — VAD and transcribers are heavy; reuse across instances
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedVad: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cachedTranscribers = new Map<string, any>()
let inferenceChain: Promise<unknown> = Promise.resolve()

export class StreamingMoonshineEngine implements SpeechEngine {
  readonly name: string
  readonly isOffline = true

  private modelId: string
  private engineId: STTEngineId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transcriber: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private vad: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private TensorClass: any = null

  private loading = false
  private loadError: string | null = null
  private permanentlyFailed = false

  private audioCtx: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null

  // Streaming state
  private fullBuffer: Float32Array = new Float32Array(0)
  private bufferPointer = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private vadState: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private srTensor: any = null
  private isCurrentlySpeech = false
  private postSpeechSamples = 0
  private prevBuffers: Float32Array[] = []
  private accumulatorTail = new Float32Array(0)
  private fragments: string[] = []

  private interimListeners = new Set<(t: string) => void>()

  constructor(engineId: STTEngineId) {
    this.engineId = engineId
    this.modelId = ENGINE_TO_MODEL[engineId] ?? "onnx-community/moonshine-base-ONNX"
    this.name = `Streaming Moonshine (${this.modelId})`
  }

  isAvailable(): boolean {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined"
  }

  getStream(): MediaStream | null {
    return this.stream
  }

  onInterim(callback: (transcript: string) => void): () => void {
    this.interimListeners.add(callback)
    return () => { this.interimListeners.delete(callback) }
  }

  private emitInterim(text: string) {
    for (const cb of this.interimListeners) {
      try { cb(text) } catch { /* ignore listener errors */ }
    }
  }

  /** Detect WebGPU once. */
  private async tryWebGPU(): Promise<boolean> {
    if (typeof navigator === "undefined") return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpu = (navigator as any).gpu
    if (!gpu) return false
    try {
      const adapter = await gpu.requestAdapter()
      return !!adapter
    } catch {
      return false
    }
  }

  private async loadModels(): Promise<boolean> {
    if (this.transcriber && this.vad) return true
    if (this.permanentlyFailed) return false
    if (this.loading) {
      // wait
      return new Promise((resolve) => {
        const tick = setInterval(() => {
          if (!this.loading) { clearInterval(tick); resolve(!!this.transcriber) }
        }, 200)
        setTimeout(() => { clearInterval(tick); resolve(!!this.transcriber) }, 60000)
      })
    }
    this.loading = true
    try {
      const lib = await import("@huggingface/transformers")
      const { AutoModel, pipeline, Tensor, env } = lib
      env.allowRemoteModels = true
      this.TensorClass = Tensor

      // Detect Electron — its Chromium has incomplete WebGPU subgroup support.
      const isElectron = typeof navigator !== "undefined" && /Electron\//i.test(navigator.userAgent)
      const useGPU = !isElectron && (await this.tryWebGPU())
      const device = useGPU ? "webgpu" : "wasm"
      console.log(`[StreamingMoonshine] Loading on ${device}${isElectron ? " (Electron forces WASM)" : ""}...`)

      // VAD
      if (!cachedVad) {
        cachedVad = await AutoModel.from_pretrained("onnx-community/silero-vad", {
          // @ts-expect-error - the lib accepts these even if the type is strict
          config: { model_type: "custom" },
          dtype: "fp32",
        })
      }
      this.vad = cachedVad

      // Transcriber
      let transcriber = cachedTranscribers.get(this.modelId)
      if (!transcriber) {
        const dtype = useGPU
          ? { encoder_model: "fp32", decoder_model_merged: "q4" }
          : { encoder_model: "fp32", decoder_model_merged: "q8" }
        transcriber = await pipeline(
          "automatic-speech-recognition",
          this.modelId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { device, dtype } as any,
        )
        // Warm up
        await transcriber(new Float32Array(SAMPLE_RATE))
        cachedTranscribers.set(this.modelId, transcriber)
      }
      this.transcriber = transcriber

      // VAD state
      this.vadState = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128])
      this.srTensor = new Tensor("int64", [BigInt(SAMPLE_RATE)], [])

      console.log("[StreamingMoonshine] Models ready.")
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn("[StreamingMoonshine] Load failed:", msg)
      this.loadError = `Failed to load streaming model: ${msg}`
      this.permanentlyFailed = true
      return false
    } finally {
      this.loading = false
    }
  }

  async start(): Promise<void> {
    if (this.permanentlyFailed) {
      throw new Error(this.loadError ?? "Streaming model unavailable.")
    }

    // Load models in parallel with mic setup
    const loadPromise = this.loadModels()

    // Mic + AudioContext at 16 kHz
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: SAMPLE_RATE,
      },
    })

    this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
    await this.audioCtx.audioWorklet.addModule("/audio-streaming-worklet.js")

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream)
    this.workletNode = new AudioWorkletNode(this.audioCtx, "streaming-processor")

    // Reset state
    this.fullBuffer = new Float32Array(MAX_BUFFER_DURATION * SAMPLE_RATE)
    this.bufferPointer = 0
    this.isCurrentlySpeech = false
    this.postSpeechSamples = 0
    this.prevBuffers = []
    this.accumulatorTail = new Float32Array(0)
    this.fragments = []

    this.workletNode.port.onmessage = (event) => {
      this.handleWorkletFrame(event.data as Float32Array)
    }

    this.sourceNode.connect(this.workletNode)
    // Don't connect workletNode to destination — we don't want to play it back

    // Wait for models to be ready (don't block start, but if user speaks before
    // models load, the chunks accumulate until handleWorkletFrame can process)
    await loadPromise
  }

  /** Called for every ~128-sample frame from the AudioWorklet. */
  private async handleWorkletFrame(frame: Float32Array) {
    if (!this.vad || !this.transcriber || !this.TensorClass) return

    // Accumulate frames into 512-sample chunks
    const combined = new Float32Array(this.accumulatorTail.length + frame.length)
    combined.set(this.accumulatorTail, 0)
    combined.set(frame, this.accumulatorTail.length)

    let offset = 0
    while (offset + VAD_CHUNK_SIZE <= combined.length) {
      const chunk = combined.subarray(offset, offset + VAD_CHUNK_SIZE)
      offset += VAD_CHUNK_SIZE
      // Process this chunk asynchronously but in order
      await this.processChunk(new Float32Array(chunk))
    }
    this.accumulatorTail = combined.subarray(offset).slice()
  }

  /** Run VAD on a 512-sample chunk and update streaming state. */
  private async processChunk(chunk: Float32Array) {
    const wasRecording = this.isCurrentlySpeech

    let isSpeech = false
    try {
      const input = new this.TensorClass("float32", chunk, [1, chunk.length])
      const result = await (inferenceChain = inferenceChain.then(() =>
        this.vad({ input, sr: this.srTensor, state: this.vadState }),
      )) as { stateN: unknown; output: { data: Float32Array } }
      this.vadState = result.stateN
      const prob = result.output.data[0]
      isSpeech =
        prob > SPEECH_THRESHOLD ||
        (this.isCurrentlySpeech && prob >= EXIT_THRESHOLD)
    } catch (e) {
      console.warn("[StreamingMoonshine] VAD error:", e)
      return
    }

    // Not recording and chunk is not speech → maybe push to prev buffer
    if (!wasRecording && !isSpeech) {
      if (this.prevBuffers.length >= MAX_NUM_PREV_BUFFERS) this.prevBuffers.shift()
      this.prevBuffers.push(chunk)
      return
    }

    // Append chunk to global buffer
    const remaining = this.fullBuffer.length - this.bufferPointer
    if (chunk.length >= remaining) {
      this.fullBuffer.set(chunk.subarray(0, remaining), this.bufferPointer)
      this.bufferPointer += remaining
      const overflow = chunk.subarray(remaining)
      await this.dispatchTranscriptionAndReset(overflow)
      return
    }
    this.fullBuffer.set(chunk, this.bufferPointer)
    this.bufferPointer += chunk.length

    if (isSpeech) {
      this.isCurrentlySpeech = true
      this.postSpeechSamples = 0
      return
    }

    // Was recording, current chunk is not speech → check if silence is long enough
    this.postSpeechSamples += chunk.length
    if (this.postSpeechSamples < MIN_SILENCE_DURATION_SAMPLES) return

    if (this.bufferPointer < MIN_SPEECH_DURATION_SAMPLES) {
      // Too short, discard
      this.resetBuffer()
      return
    }

    // End of speech segment — transcribe
    await this.dispatchTranscriptionAndReset()
  }

  private async dispatchTranscriptionAndReset(overflow?: Float32Array) {
    const segment = this.fullBuffer.slice(0, this.bufferPointer + SPEECH_PAD_SAMPLES)
    // Prepend the prev buffers (audio from just before VAD detected speech)
    const prevLen = this.prevBuffers.reduce((a, b) => a + b.length, 0)
    const padded = new Float32Array(prevLen + segment.length)
    let off = 0
    for (const p of this.prevBuffers) {
      padded.set(p, off)
      off += p.length
    }
    padded.set(segment, off)

    // Reset for the next segment (overlap any overflow into the new buffer)
    if (overflow && overflow.length > 0) {
      this.fullBuffer.set(overflow, 0)
      this.bufferPointer = overflow.length
    } else {
      this.bufferPointer = 0
    }
    this.isCurrentlySpeech = false
    this.postSpeechSamples = 0
    this.prevBuffers = []

    // Run transcription (chained to avoid concurrent inference)
    try {
      const result = await (inferenceChain = inferenceChain.then(() =>
        this.transcriber(padded),
      )) as { text?: string }
      const text = (result?.text ?? "").trim()
      if (text) {
        this.fragments.push(text)
        // Emit the running transcript so the UI shows live updates
        this.emitInterim(this.fragments.join(" "))
      }
    } catch (e) {
      console.warn("[StreamingMoonshine] Transcription error:", e)
    }
  }

  private resetBuffer() {
    this.bufferPointer = 0
    this.isCurrentlySpeech = false
    this.postSpeechSamples = 0
    this.prevBuffers = []
  }

  async stop(): Promise<SpeechRecognitionResult> {
    // Disconnect audio
    try {
      this.sourceNode?.disconnect()
      this.workletNode?.disconnect()
      await this.audioCtx?.close()
    } catch { /* ignore */ }
    this.sourceNode = null
    this.workletNode = null
    this.audioCtx = null

    // If there's still buffered speech that didn't reach end-of-speech via VAD,
    // transcribe it now so we don't lose the final words.
    if (this.bufferPointer >= MIN_SPEECH_DURATION_SAMPLES) {
      try {
        await this.dispatchTranscriptionAndReset()
      } catch { /* ignore */ }
    }

    // Stop the mic
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }

    const transcript = this.fragments.join(" ").toLowerCase().trim()
    if (!transcript) {
      return {
        transcript: "",
        confidence: 0,
        errorCode: "no-speech",
        errorMessage: "No speech detected. Try speaking louder or longer.",
      }
    }
    return { transcript, confidence: 0.85 }
  }
}
