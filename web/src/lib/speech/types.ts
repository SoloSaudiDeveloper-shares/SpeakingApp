export interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
  wordTimings?: Array<{ word: string; start: number; end: number }>;
  audioDurationSeconds?: number;
  audioBlob?: Blob;
  partial?: boolean;
  /** When set, indicates a structured failure (e.g. network, no-speech, model-load). */
  errorCode?: SpeechErrorCode;
  /** Human-readable error message. */
  errorMessage?: string;
}

export type SpeechErrorCode =
  | "network"          // Web Speech API can't reach Google
  | "no-speech"        // Mic was on but no speech detected
  | "audio-capture"    // Mic problem
  | "not-allowed"      // Permission denied
  | "model-load"       // Offline model failed to load
  | "aborted"          // Recognition was aborted
  | "unknown";

export interface SpeechEngine {
  readonly name: string;
  readonly isOffline: boolean;
  isAvailable(): boolean;
  start(): Promise<void>;
  stop(): Promise<SpeechRecognitionResult>;
  /** Get the active MediaStream for audio visualization (null if not recording) */
  getStream(): MediaStream | null;
  /** Subscribe to live interim transcript updates while recording.
   *  Returns an unsubscribe function. Engines that don't support live
   *  transcription can no-op. */
  onInterim?(callback: (transcript: string) => void): () => void;
  /** Optionally warm up the engine (e.g. load the offline model) ahead of the
   *  first recording so there's no cold-start delay. Safe to call repeatedly. */
  prepare?(): Promise<void>;
  /** Re-run recognition on a preserved recording after a recoverable failure. */
  transcribeBlob?(blob: Blob): Promise<SpeechRecognitionResult>;
}

export type STTEngineId =
  | "azure-speech"
  | "groq-whisper"
  | "web-speech-api"
  | "webai-whisper-tiny"
  | "webai-whisper-base"
  | "webai-whisper-small"
  | "webai-moonshine-tiny"
  | "webai-moonshine-base";

export interface SttEngineOption {
  id: STTEngineId;
  name: string;
  /** Short label for compact UI (used by mic-test page) */
  label: string;
  offline: boolean;
  size: string;
  quality: string;
  speed: string;
  compute: string;
}

export const STT_ENGINE_OPTIONS: SttEngineOption[] = [
  { id: "azure-speech",       name: "Azure Speech", label: "Azure Speech (cloud)", offline: false, size: "0 MB", quality: "Excellent", speed: "Real-time", compute: "Cloud + offline fallback" },
  // Groq's hosted Whisper is the default: fast and very accurate online, with an
  // automatic fall back to the bundled offline Whisper when there's no internet.
  { id: "groq-whisper",        name: "Groq Whisper (cloud)", label: "Groq Whisper (cloud)", offline: false, size: "0 MB", quality: "Excellent", speed: "Real-time", compute: "Cloud + offline fallback" },
  // Whisper Tiny ships bundled with the web app and runs locally on the CPU
  // (WASM), without internet or WebGPU. Web Speech is browser/vendor dependent.
  // The other models download on first use if explicitly selected.
  { id: "web-speech-api",      name: "Web Speech API", label: "Web Speech (online)", offline: false, size: "0 MB",   quality: "Good",      speed: "Real-time", compute: "Cloud"      },
  { id: "webai-whisper-tiny",  name: "Whisper Tiny",   label: "Whisper Tiny (bundled)", offline: true,  size: "Bundled", quality: "Good",      speed: "Fast",      compute: "CPU (WASM)" },
  { id: "webai-whisper-base",  name: "Whisper Base",   label: "Whisper Base",           offline: false, size: "~210 MB", quality: "Very Good", speed: "Medium",    compute: "Download required" },
  { id: "webai-whisper-small", name: "Whisper Small",  label: "Whisper Small",          offline: false, size: "~600 MB", quality: "Excellent", speed: "Slow",      compute: "Download required" },
  { id: "webai-moonshine-tiny",name: "Moonshine Tiny", label: "Moonshine Tiny",         offline: false, size: "~50 MB",  quality: "Good",      speed: "Very Fast", compute: "Download required" },
  { id: "webai-moonshine-base",name: "Moonshine Base", label: "Moonshine Base",         offline: false, size: "~120 MB", quality: "Very Good", speed: "Fast",      compute: "Download required" },
];
