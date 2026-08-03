import { TRPCError } from '@trpc/server';

/**
 * Mock top-up is a local/dev QA convenience only.
 * Production (`NODE_ENV=production`) always rejects — no env flag can override.
 */
export function assertMockTopupAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'MOCK_TOPUP_DISABLED' });
  }

  // Non-production still requires explicit enablement to avoid accidental minting
  // in shared staging that forgets to set NODE_ENV=production.
  if (process.env.AICO_ALLOW_MOCK_TOPUP !== '1' && process.env.AICO_ALLOW_MOCK_TOPUP !== 'true') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'MOCK_TOPUP_DISABLED' });
  }
}

export function isMockTopupUiEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.AICO_ALLOW_MOCK_TOPUP === '1' || process.env.AICO_ALLOW_MOCK_TOPUP === 'true';
}
