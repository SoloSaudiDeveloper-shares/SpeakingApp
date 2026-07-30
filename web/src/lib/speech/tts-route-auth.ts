import 'server-only';

import {
  requireAdmin,
  requireAuthenticated,
} from '@/lib/auth/authorization';
import type { SessionUser } from '@/lib/actions/auth-actions';
import { mutationRequestViolation } from '@/lib/security/request-protection';

export type TtsAuthResult =
  | { user: SessionUser }
  | { response: Response };

export async function requireTtsUser(): Promise<TtsAuthResult> {
  const auth = await requireAuthenticated();
  return auth.ok ? { user: auth.user } : { response: auth.response };
}

export async function requireTtsAdmin(): Promise<TtsAuthResult> {
  const auth = await requireAdmin();
  return auth.ok ? { user: auth.user } : { response: auth.response };
}

export function rejectCrossOriginMutation(request: Request): Response | null {
  const violation = mutationRequestViolation(request);
  return violation
    ? Response.json({ error: violation }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
    : null;
}
