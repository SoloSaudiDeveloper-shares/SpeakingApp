/**
 * Multi-engine text-to-speech abstraction (parallels the STT SpeechEngine).
 * Each engine knows how to list its voices and speak text; neural engines
 * synthesize PCM and play it through the shared Web Audio player, while the
 * browser engine drives the OS speechSynthesis directly.
 */

export type TtsEngineId = "browser-tts" | "kokoro" | "piper";

export interface TtsVoice {
  /** Engine-specific voice id (browser voice name, Kokoro "af_heart", Piper voiceId). */
  id: string;
  label: string;
  accent?: string;   // "American" | "British"
  gender?: "male" | "female";
  lang?: string;
}

export interface SpeakOptions {
  voice?: string | null;
  rate?: number;    // 0.5–2.0, 1.0 = normal
  volume?: number;  // 0–1
}

export interface TtsEngine {
  readonly id: TtsEngineId;
  readonly name: string;
  readonly isOffline: boolean;
  /** True if the engine can run in this environment at all. */
  isAvailable(): boolean;
  /** Voices this engine offers (may load asynchronously). */
  listVoices(): Promise<TtsVoice[]>;
  /** Speak text and resolve when playback finishes. */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Stop any in-progress playback immediately. */
  cancel(): void;
  /** Optional warm-up (load the offline model) before the first speak(). */
  prepare?(): Promise<void>;
}

export interface TtsEngineOption {
  id: TtsEngineId;
  name: string;
  offline: boolean;
  quality: string;
  speed: string;
  size: string;
  /** Bundled with the app (works offline immediately). */
  bundled: boolean;
  description: string;
}

export const TTS_ENGINE_OPTIONS: TtsEngineOption[] = [
  {
    id: "browser-tts",
    name: "Browser / System voice",
    offline: true,
    quality: "Varies by OS",
    speed: "Real-time",
    size: "0 MB",
    bundled: true,
    description:
      "Uses your operating system's built-in voices. Always available, but quality varies and the most natural Windows voices need internet.",
  },
  {
    id: "kokoro",
    name: "Kokoro (neural, offline)",
    offline: true,
    quality: "Excellent",
    speed: "Medium (CPU)",
    size: "~92 MB",
    bundled: true,
    description:
      "High-quality neural voices (American & British, male & female) that run fully offline on the CPU. Best for clear pronunciation models.",
  },
  {
    id: "piper",
    name: "Piper (neural, offline)",
    offline: true,
    quality: "Very good",
    speed: "Fast (CPU)",
    size: "downloads on first use",
    bundled: false,
    description:
      "Fast, lightweight neural voices. The voice model downloads once on first use (then cached offline). Snappier than Kokoro, slightly less natural.",
  },
];
