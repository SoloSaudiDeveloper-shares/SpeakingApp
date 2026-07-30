import { timingSafeEqual } from "node:crypto"

const PROBE_BYTES = 2 * 1024 * 1024
const CHUNK_BYTES = 64 * 1024

function authorized(request: Request): boolean {
  const expected = process.env.XAPI_JOB_TOKEN
  const header = request.headers.get("authorization")
  if (!expected || expected.length < 24 || !header?.startsWith("Bearer ")) {
    return false
  }

  const actual = header.slice("Bearer ".length)
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= PROBE_BYTES) {
        controller.close()
        return
      }
      const length = Math.min(CHUNK_BYTES, PROBE_BYTES - sent)
      const chunk = new Uint8Array(length)
      chunk.fill((sent / CHUNK_BYTES) % 251)
      sent += length
      controller.enqueue(chunk)
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Length": String(PROBE_BYTES),
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Delivery-Probe": "speaking-lab-2mib",
    },
  })
}
