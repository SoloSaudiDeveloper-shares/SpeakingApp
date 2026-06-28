"use client"

/**
 * Browser-based speech recognition using Web Speech API.
 * Works in Chrome, Edge, Safari. Falls back gracefully if unavailable.
 */

// Web Speech API types (not all browsers have these in TypeScript)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
  readonly isFinal: boolean;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionResult = {
  transcript: string;
  confidence: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: SpeechRecognitionInstance | null = null;
let resolvePromise: ((result: RecognitionResult) => void) | null = null;

export function isSpeechRecognitionAvailable(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export function startSpeechRecognition(): Promise<RecognitionResult> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Not in browser"));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      reject(new Error("Speech recognition not supported"));
      return;
    }

    if (recognition) {
      try { recognition.abort(); } catch { /* ignore */ }
    }

    recognition = new SpeechRecognitionClass() as SpeechRecognitionInstance;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    resolvePromise = resolve;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[0]?.[0];
      if (result && resolvePromise) {
        resolvePromise({
          transcript: result.transcript.toLowerCase().trim(),
          confidence: result.confidence,
        });
        resolvePromise = null;
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === "no-speech" || event.error === "aborted") {
        if (resolvePromise) {
          resolvePromise({ transcript: "", confidence: 0 });
          resolvePromise = null;
        }
      } else {
        if (resolvePromise) {
          resolvePromise({ transcript: "", confidence: 0 });
          resolvePromise = null;
        }
      }
    };

    recognition.onend = () => {
      if (resolvePromise) {
        resolvePromise({ transcript: "", confidence: 0 });
        resolvePromise = null;
      }
    };

    recognition.start();
  });
}

export function stopSpeechRecognition(): void {
  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
  }
}
