import { sqlite } from '@/lib/db';

export async function GET() {
  try {
    sqlite.prepare('SELECT 1').get();
    return Response.json({
      ok: true,
      service: 'speaking-lab',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json({ ok: false, service: 'speaking-lab' }, { status: 503 });
  }
}
