export async function GET() {
  return Response.json({
    ok: true,
    service: 'speaking-lab',
    timestamp: new Date().toISOString(),
  });
}
