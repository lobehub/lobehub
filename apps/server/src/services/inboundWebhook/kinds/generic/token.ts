import { randomBytes, timingSafeEqual } from 'node:crypto';

import { appEnv } from '@/envs/app';

/** 256 random bits, URL-safe, so the token can sit in a path segment as is. */
export const generateWebhookToken = () => randomBytes(32).toString('base64url');

/** The token the caller presented: the path segment, else `Authorization: Bearer`. */
export const presentedToken = (request: { headers: Headers; pathToken?: string }) => {
  if (request.pathToken) return request.pathToken;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1];
};

export const tokenMatches = (presented: string | undefined, secret: string | null) => {
  if (!presented || !secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The URL a caller posts to; anyone holding it can wake the Agent. */
export const genericWebhookEndpoint = (id: string, token: string) =>
  new URL(`/api/webhooks/inbound/${id}/${encodeURIComponent(token)}`, appEnv.APP_URL).toString();
