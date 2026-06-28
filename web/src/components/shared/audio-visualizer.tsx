"use client"

import { useEffect, useRef, useState } from "react"

interface AudioVisualizerProps {
  stream: MediaStream | null
  isRecording: boolean
}

/**
 * Real-time audio visualizer showing animated bars based on mic input.
 * Shows when recording is active, hides otherwise.
 */
export function AudioVisualizer({ stream, isRecording }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [hasAudio, setHasAudio] = useState(false)

  useEffect(() => {
    if (!isRecording || !stream || !canvasRef.current) {
      // Clean up
      if (animRef.current) cancelAnimationFrame(animRef.current)
      analyserRef.current = null
      setHasAudio(false)
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set up audio analyser
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    analyserRef.current = analyser

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    const barCount = 24
    const barGap = 3

    setHasAudio(true)

    const draw = () => {
      if (!analyserRef.current) return
      animRef.current = requestAnimationFrame(draw)

      analyser.getByteFrequencyData(dataArray)

      const width = canvas.width
      const height = canvas.height
      const barWidth = (width - barGap * (barCount - 1)) / barCount

      ctx.clearRect(0, 0, width, height)

      for (let i = 0; i < barCount; i++) {
        // Map frequency bins to bar count
        const dataIdx = Math.floor(i * bufferLength / barCount)
        const value = dataArray[dataIdx] / 255

        // Bar height with minimum
        const barHeight = Math.max(3, value * height * 0.9)

        // Color gradient based on level
        const hue = 200 - value * 80 // blue to green
        const saturation = 70 + value * 30
        const lightness = 45 + value * 15

        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`

        // Draw bar centered vertically
        const x = i * (barWidth + barGap)
        const y = (height - barHeight) / 2

        // Rounded bars
        const radius = Math.min(barWidth / 2, 4)
        ctx.beginPath()
        ctx.moveTo(x + radius, y)
        ctx.lineTo(x + barWidth - radius, y)
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius)
        ctx.lineTo(x + barWidth, y + barHeight - radius)
        ctx.quadraticCurveTo(x + barWidth, y + barHeight, x + barWidth - radius, y + barHeight)
        ctx.lineTo(x + radius, y + barHeight)
        ctx.quadraticCurveTo(x, y + barHeight, x, y + barHeight - radius)
        ctx.lineTo(x, y + radius)
        ctx.quadraticCurveTo(x, y, x + radius, y)
        ctx.fill()
      }
    }

    draw()

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      analyserRef.current = null
      audioCtx.close()
    }
  }, [stream, isRecording])

  if (!isRecording) return null

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={240}
        height={48}
        className="rounded-lg"
      />
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
        </span>
        <span className="text-xs text-red-400 font-medium">
          {hasAudio ? "Listening..." : "Waiting for mic..."}
        </span>
      </div>
    </div>
  )
}
