import { createHash } from 'node:crypto';

import { createAuthMiddleware } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import { recordAuthAbuseSignal } from '@/server/services/aico/securityAlert';

const OTP_VERIFY_PATHS = new Set(['/phone-number/verify', '/email-otp/verify-email']);

const hashIp = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * Counts OTP verify attempts per client IP and alerts on bursts (MON-003).
 * Uses a before-hook (attempt volume), not verified failures — avoids logging
 * raw OTP codes or phone numbers. Cooldown is process-local (db is null here).
 */
export const authAbuseSignal = (): BetterAuthPlugin => ({
  id: 'aico-auth-abuse-signal',
  hooks: {
    before: [
      {
        matcher: (ctx) => OTP_VERIFY_PATHS.has(ctx.path),
        handler: createAuthMiddleware(async (ctx) => {
          const forwarded = ctx.headers?.get?.('x-forwarded-for');
          const ip =
            forwarded?.split(',')[0]?.trim() ||
            ctx.headers?.get?.('x-real-ip')?.trim() ||
            'anonymous';
          void recordAuthAbuseSignal(null, {
            key: hashIp(ip),
            kind: 'otp_fail',
            threshold: 25,
            windowMs: 5 * 60_000,
          });
        }),
      },
    ],
  },
});
