"use client"

/**
 * Detect WebGPU support so we can disable offline (WebAI) engines on
 * unsupported devices instead of letting them throw at use-time.
 *
 * The result is cached for the session.
 */

let cached: boolean | null = null
let pending: Promise<boolean> | null = null

export async function checkWebGPU(): Promise<boolean> {
  if (cached !== null) return cached
  if (pending) return pending

  pending = (async () => {
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
  })()

  cached = await pending
  pending = null
  return cached
}

export function isWebGPUKnown(): boolean | null {
  return cached
}
