import { createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Headers the gateway puts on every frame it forwards to the webhook. Frames arrive over a socket
 * authenticated with the bot Secret, so the gateway signs the forwarded body with that same
 * Secret and the webhook refuses anything unsigned: without it, anyone who knows the BotID could
 * POST a fake message into the agent.
 */
export const WECOM_SIGNATURE_HEADER = 'x-lobehub-wecom-signature';
export const WECOM_TIMESTAMP_HEADER = 'x-lobehub-wecom-timestamp';

/** Forwarded frames older (or newer) than this are rejected as replays. */
export const WECOM_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export const signForwardedFrame = (secret: string, timestamp: string, body: string): string =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

export const verifyForwardedFrame = (
  secret: string,
  timestamp: string | null | undefined,
  signature: string | null | undefined,
  body: string,
  now = Date.now(),
): boolean => {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WECOM_SIGNATURE_MAX_SKEW_MS) return false;

  const expected = Buffer.from(signForwardedFrame(secret, timestamp, body), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/**
 * Decrypt an inbound media file. WeCom encrypts every download with AES-256-CBC: the key is the
 * base64 `aeskey` sent with the URL, the IV its first 16 bytes, and the plaintext is PKCS#7
 * padded to a 32-byte block — which Node's auto-padding (16-byte block) rejects, so padding is
 * stripped by hand. Same algorithm as the official SDK's `decryptFile`.
 */
export const decryptWeComMedia = (encrypted: Buffer, aesKey: string): Buffer => {
  if (!encrypted?.length) throw new Error('WeCom media is empty');
  const key = Buffer.from(aesKey, 'base64');
  if (key.length !== 32) throw new Error('WeCom media aeskey must decode to 32 bytes');

  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  const pad = decrypted.at(-1) ?? 0;
  if (pad < 1 || pad > 32 || pad > decrypted.length) {
    throw new Error('WeCom media has invalid padding');
  }
  for (let i = decrypted.length - pad; i < decrypted.length; i++) {
    if (decrypted[i] !== pad) throw new Error('WeCom media has invalid padding');
  }
  return decrypted.subarray(0, decrypted.length - pad);
};
