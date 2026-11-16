import { createHmac, timingSafeEqual } from 'node:crypto';

/** DingTalk rejects HTTP callbacks whose timestamp drifts more than 1 hour. */
export const CALLBACK_MAX_SKEW_MS = 60 * 60 * 1000;

/**
 * Compute the robot callback signature used by DingTalk's HTTP callback mode:
 * `Base64(HmacSHA256(key = clientSecret, message = timestamp + "\n" + clientSecret))`,
 * sent in the `sign` header next to a `timestamp` (Unix ms) header.
 *
 * The Stream gateway signs the events it forwards the same way, so the
 * webhook handler authenticates both paths with one check.
 */
export function signCallback(timestamp: string, clientSecret: string): string {
  return createHmac('sha256', clientSecret)
    .update(`${timestamp}\n${clientSecret}`)
    .digest('base64');
}

export function verifyCallbackSignature(
  timestamp: string | null,
  sign: string | null,
  clientSecret: string,
  now = Date.now(),
): boolean {
  if (!timestamp || !sign) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > CALLBACK_MAX_SKEW_MS) return false;

  const expected = Buffer.from(signCallback(timestamp, clientSecret));
  const actual = Buffer.from(sign);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
