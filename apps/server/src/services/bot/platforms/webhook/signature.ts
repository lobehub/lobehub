import { timingSafeEqual } from 'node:crypto';

import { signWebhookPayload } from '@/server/services/developerWebhook/signature';

import { BOT_WEBHOOK_TOLERANCE_SECONDS } from './protocol';

export type InboundSignatureFailure = 'invalid_signature' | 'missing_signature' | 'stale_timestamp';

/**
 * Check an inbound request signed with the bot's secret, the same scheme LobeHub uses
 * to sign what it sends: `v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`.
 * The timestamp is part of the signed string and must be within the tolerance window,
 * so a captured request cannot be replayed later.
 */
export const verifyInboundSignature = ({
  body,
  now = Date.now(),
  secret,
  signature,
  timestamp,
}: {
  body: string;
  now?: number;
  secret: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}): { ok: true } | { ok: false; reason: InboundSignatureFailure } => {
  if (!signature || !timestamp || !secret) return { ok: false, reason: 'missing_signature' };

  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(now / 1000 - seconds) > BOT_WEBHOOK_TOLERANCE_SECONDS)
    return { ok: false, reason: 'stale_timestamp' };

  const expected = Buffer.from(signWebhookPayload(secret, seconds, body));
  // A header may carry several space-separated signatures (secret rotation).
  const matched = signature
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((candidate) => {
      const given = Buffer.from(candidate);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  return matched ? { ok: true } : { ok: false, reason: 'invalid_signature' };
};
