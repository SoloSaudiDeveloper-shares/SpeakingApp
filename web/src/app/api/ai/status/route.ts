import { probeProvider, getActiveProvider } from '@/lib/ai/providers';

export async function GET() {
  try {
    const cfg = await getActiveProvider();
    const probe = await probeProvider();
    return Response.json({
      online: probe.ok,
      provider: cfg.provider,
      model: cfg.model,
      detail: probe.detail,
    });
  } catch (e) {
    return Response.json({
      online: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
