// AudioWorkletProcessor that emits raw 16kHz mono Float32 frames to the main
// thread. Used by the streaming Moonshine engine to capture audio chunks for
// VAD + transcription without going through MediaRecorder/encoding.
class StreamingProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0] && input[0].length > 0) {
      // Copy because the underlying buffer is reused
      this.port.postMessage(new Float32Array(input[0]))
    }
    return true
  }
}
registerProcessor("streaming-processor", StreamingProcessor)
