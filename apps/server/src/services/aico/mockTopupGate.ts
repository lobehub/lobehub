import { TRPCError } from '@trpc/server';

import { aicoEnv } from '@/envs/aico';

/**
 * Mock top-up is a dev/QA convenience that credits a wallet without a real payment gateway.
 * It must never be reachable in production unless explicitly allow-listed.
 */
export function assertMockTopupAllowed(): void {
  if (process.env.NODE_ENV === 'production' && !aicoEnv.AICO_ALLOW_MOCK_TOPUP) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'MOCK_TOPUP_DISABLED' });
  }
}
