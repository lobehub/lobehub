import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_HEADER = 'x-lobe-callback-signature';
const MAX_AGE_MS = 5 * 60 * 1000;

function signatureFor(
  secret: string,
  url: string,
  method: string,
  body: string,
  timestamp: string,
) {
  // Separate callback authentication from other uses of the vault secret.
  const key = createHmac('sha256', secret).update('lobehub:internal-callback:v1').digest();
  const { pathname, search } = new URL(url);
  return createHmac('sha256', key)
    .update(JSON.stringify([timestamp, method, pathname + search, body]))
    .digest('hex');
}

/** Sign only same-origin callbacks when QStash authentication is not configured. */
export function signInternalCallback(url: string, body: string): Record<string, string> {
  const secret = process.env.KEY_VAULTS_SECRET;
  if (!secret || process.env.QSTASH_CURRENT_SIGNING_KEY || process.env.QSTASH_NEXT_SIGNING_KEY)
    return {};

  const origin = new URL(url).origin;
  const isApplicationOrigin = [process.env.INTERNAL_APP_URL, process.env.APP_URL].some((base) => {
    if (!base) return false;
    try {
      return new URL(base).origin === origin;
    } catch {
      return false;
    }
  });
  if (!isApplicationOrigin) return {};

  const timestamp = String(Date.now());
  return {
    [SIGNATURE_HEADER]: `${timestamp}.${signatureFor(secret, url, 'POST', body, timestamp)}`,
  };
}

/** Validate the body, method, destination path and freshness without exposing the vault secret. */
export function verifyInternalCallback(request: Request, body: string): boolean {
  const secret = process.env.KEY_VAULTS_SECRET;
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!secret || !signature) return false;
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(signature);
  if (!match) return false;
  const [, timestamp, mac] = match;
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_AGE_MS) return false;
  const expected = signatureFor(secret, request.url, request.method, body, timestamp);
  return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'));
}
