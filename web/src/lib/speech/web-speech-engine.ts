"use client"

import type { SpeechEngine, SpeechRecognitionResult, SpeechErrorCode } from "./types";

/**
 * Web Speech API engine — uses browser built-in recognition.
 * Also captures a MediaStream for audio visualization.
 *
 * Key design: we use continuous mode so recognition doesn't auto-stop
 * after a brief silence. The user controls when to stop via the UI button.
 * The mic stream for visualization is kept alive until AFTER recognition ends.
 */
export class WebSpeechEngine implements SpeechEngine {
  readonly name = "Web Speech API";
  readonly isOffline = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private resolveStop: ((result: SpeechRecognitionResult) => void) | null = null;
  private transcript = "";
  private confidence = 0;
  private stream: MediaStream | null = null;
  private manualStop = false;
  private lastError: { code: SpeechErrorCode; message: string } | null = null;
  private interimListeners = new Set<(t: string) => void>();

  onInterim(callback: (transcript: string) => void): () => void {
    this.interimListeners.add(callback);
    return () => { this.interimListeners.delete(callback); };
  }

  /** Expose the mic stream so UI can visualize audio levels */
  getStream(): MediaStream | null {
    return this.stream;
  }

  isAvailable(): boolean {
    if (typeof window === "undefined") return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  async start(): Promise<void> {
    if (!this.isAvailable()) throw new Error("Web Speech API not available");

    // Request mic permission FIRST — this triggers the browser prompt
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
    } catch (e) {
      console.error("Microphone access denied:", e);
      throw new Error("Microphone access denied. Please allow microphone in your browser.");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    this.transcript = "";
    this.confidence = 0;
    this.manualStop = false;
    this.lastError = null;

    const rec = new SpeechRecognitionClass();
    rec.lang = "en-US";
    rec.continuous = true;        // Keep listening until user stops
    rec.interimResults = true;    // Capture partial results too
    rec.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      // Collect all final + interim results into one transcript
      let finalTranscript = "";
      let interimTranscript = "";
      let bestConfidence = 0;

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        if (!alt) continue;

        if (result.isFinal) {
          finalTranscript += alt.transcript + " ";
          bestConfidence = Math.max(bestConfidence, alt.confidence ?? 0);
        } else {
          interimTranscript += alt.transcript + " ";
        }
      }

      // Prefer final transcript, fall back to interim
      const combined = finalTranscript.trim() || interimTranscript.trim();
      if (combined) {
        this.transcript = combined.toLowerCase().trim();
        this.confidence = bestConfidence || 0.5;
        // Notify subscribers of the live interim transcript
        for (const cb of this.interimListeners) {
          try { cb(this.transcript); } catch { /* ignore listener errors */ }
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (event: any) => {
      const code = event.error as string;
      console.warn("[WebSpeech] error:", code);

      // Map raw error to a human message
      const errorMap: Record<string, { code: SpeechErrorCode; message: string }> = {
        "network": {
          code: "network",
          message: "Web Speech API needs internet (it sends audio to Google). You appear to be offline. Try the offline Whisper / Moonshine engines instead.",
        },
        "no-speech": {
          code: "no-speech",
          message: "No speech was detected. Speak louder, closer to the mic, or for a longer time.",
        },
        "audio-capture": {
          code: "audio-capture",
          message: "Couldn't capture audio from the microphone.",
        },
        "not-allowed": {
          code: "not-allowed",
          message: "Microphone permission was denied.",
        },
        "service-not-allowed": {
          code: "not-allowed",
          message: "Speech service is blocked. Check your browser/extension settings.",
        },
        "aborted": {
          code: "aborted",
          message: "Recognition was aborted.",
        },
      };
      this.lastError = errorMap[code] ?? { code: "unknown", message: `Speech recognition error: ${code}` };

      // Don't reject on no-speech or aborted — they're normal during continuous mode
      if (code !== "no-speech" && code !== "aborted") {
        this.cleanupStream();
        if (this.resolveStop) {
          this.resolveStop({
            transcript: this.transcript || "",
            confidence: this.confidence,
            errorCode: this.lastError.code,
            errorMessage: this.lastError.message,
          });
          this.resolveStop = null;
        }
      }
    };

    rec.onend = () => {
      console.log("[WebSpeech] onend — transcript:", this.transcript);

      // If the user didn't manually stop and we have no transcript,
      // the recognition timed out. Restart it to keep listening.
      if (!this.manualStop && !this.resolveStop) {
        console.log("[WebSpeech] auto-restarting recognition (no manual stop yet)");
        try { rec.start(); } catch { /* ignore if already started */ }
        return;
      }

      // Clean up mic stream AFTER recognition has fully ended
      this.cleanupStream();

      if (this.resolveStop) {
        // If we got no transcript and the last event was a recoverable
        // error (no-speech), surface that to the caller.
        const result: SpeechRecognitionResult = {
          transcript: this.transcript,
          confidence: this.confidence,
        };
        if (!this.transcript && this.lastError) {
          result.errorCode = this.lastError.code;
          result.errorMessage = this.lastError.message;
        } else if (!this.transcript) {
          result.errorCode = "no-speech";
          result.errorMessage = "No speech was detected. Try speaking louder or closer to the mic.";
        }
        this.resolveStop(result);
        this.resolveStop = null;
      }
    };

    this.recognition = rec;
    rec.start();
    console.log("[WebSpeech] recognition started (continuous mode)");
  }

  private cleanupStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  async stop(): Promise<SpeechRecognitionResult> {
    this.manualStop = true;

    return new Promise((resolve) => {
      this.resolveStop = resolve;

      if (this.recognition) {
        try { this.recognition.stop(); } catch { /* ignore */ }
      } else {
        // No recognition running — resolve immediately
        this.cleanupStream();
        resolve({ transcript: this.transcript, confidence: this.confidence });
        return;
      }

      // Timeout fallback — if onend never fires (browser bug)
      setTimeout(() => {
        if (this.resolveStop) {
          console.warn("[WebSpeech] stop timeout — resolving with:", this.transcript);
          this.cleanupStream();
          this.resolveStop({ transcript: this.transcript, confidence: this.confidence });
          this.resolveStop = null;
        }
      }, 5000);
    });
  }
}
