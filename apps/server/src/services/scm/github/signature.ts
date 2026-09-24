import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Verify a GitHub webhook signature: `X-Hub-Signature-256` is
 * `sha256=` + hex(HMAC-SHA256(secret, raw body)). The body must be the exact
 * bytes GitHub sent, before any JSON parsing.
 */
export const verifyGitHubSignature = (params: {
  rawBody: string;
  secret: string;
  signature: string | null | undefined;
}): boolean => {
  const { rawBody, secret, signature } = params;
  if (!signature || !signature.startsWith(SIGNATURE_PREFIX)) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const actual = signature.slice(SIGNATURE_PREFIX.length);

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
};

/** Produce the header value GitHub would send for a body; used by tests and local replay. */
export const signGitHubPayload = (rawBody: string, secret: string): string =>
  `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
