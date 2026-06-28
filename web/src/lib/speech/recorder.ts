"use client"

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let stream: MediaStream | null = null;

export async function startRecording() {
  audioChunks = [];
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? { mimeType: 'audio/webm;codecs=opus' }
    : {};
  mediaRecorder = new MediaRecorder(stream, options);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };
  mediaRecorder.start(100);
}

export async function stopRecording(): Promise<{ pcmBase64: string; durationSeconds: number }> {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve({ pcmBase64: '', durationSeconds: 0 });
      return;
    }
    const currentRecorder = mediaRecorder;
    currentRecorder.onstop = async () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      if (audioChunks.length === 0) {
        resolve({ pcmBase64: '', durationSeconds: 0 });
        return;
      }
      const blob = new Blob(audioChunks, {
        type: currentRecorder.mimeType || 'audio/webm',
      });
      audioChunks = [];
      mediaRecorder = null;

      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const float32 = audioBuffer.getChannelData(0);
      const durationSeconds = audioBuffer.duration;

      const targetRate = 16000;
      let samples = float32;
      if (audioBuffer.sampleRate !== targetRate) {
        const ratio = audioBuffer.sampleRate / targetRate;
        const newLen = Math.round(float32.length / ratio);
        samples = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          samples[i] = float32[Math.round(i * ratio)];
        }
      }

      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      audioCtx.close();

      const bytes = new Uint8Array(int16.buffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.length)))
        );
      }
      resolve({ pcmBase64: btoa(binary), durationSeconds });
    };
    currentRecorder.stop();
  });
}
