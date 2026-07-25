import { checkDatabase } from '@/lib/db';

const READY_TIMEOUT_MS = 4_000;

export async function GET() {
  try {
    const database = await Promise.race([
      checkDatabase(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('PostgreSQL readiness check timed out.')), READY_TIMEOUT_MS);
      }),
    ]);
    return Response.json({
      ok: true,
      service: 'speaking-lab',
      timestamp: new Date().toISOString(),
      databaseTime: database.databaseTime,
    });
  } catch (error) {
    console.error('[health] PostgreSQL readiness check failed:', error instanceof Error ? error.message : 'unknown error');
    return Response.json({ ok: false, service: 'speaking-lab' }, { status: 503 });
  }
}
