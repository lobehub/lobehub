import { randomBytes, timingSafeEqual } from 'node:crypto';

import { appEnv } from '@/envs/app';

/** 256 random bits, URL-safe, so the key fits a header as is. */
export const generateWebhookToken = () => randomBytes(32).toString('base64url');

/** The key the caller presented as `Authorization: Bearer <key>`. */
export const presentedToken = (request: { headers: Headers }) => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1];
};

export const tokenMatches = (presented: string | undefined, secret: string | null) => {
  if (!presented || !secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The URL a caller posts to. It never changes and holds no secret: the key goes in the
 * `Authorization` header, and a new key leaves the URL as it was.
 */
export const genericWebhookEndpoint = (id: string) =>
  new URL(`/api/webhooks/inbound/${id}`, appEnv.APP_URL).toString();
