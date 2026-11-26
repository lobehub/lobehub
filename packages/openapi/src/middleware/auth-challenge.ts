import type { MiddlewareHandler } from 'hono';

import { appEnv } from '@/envs/app';
import { apiBearerChallenge } from '@/libs/oidc-provider/discovery-metadata';

export const WWW_AUTHENTICATE_HEADER = 'WWW-Authenticate';

/**
 * Every 401 tells the client how to authenticate: a Bearer challenge pointing at the
 * API's RFC 9728 protected resource metadata (which names the OIDC issuer). Applied
 * after the response is built, so it covers every 401 whichever layer produced it
 * (missing credentials, bad token, workspace or permission checks).
 */
export const authChallenge: MiddlewareHandler = async (c, next) => {
  await next();

  if (c.res.status !== 401 || c.res.headers.has(WWW_AUTHENTICATE_HEADER)) return;

  const challenge = apiBearerChallenge(appEnv.APP_URL!);
  try {
    c.res.headers.set(WWW_AUTHENTICATE_HEADER, challenge);
  } catch {
    // Immutable headers (a proxied upstream response): re-wrap it.
    const headers = new Headers(c.res.headers);
    headers.set(WWW_AUTHENTICATE_HEADER, challenge);
    c.res = new Response(c.res.body, {
      headers,
      status: c.res.status,
      statusText: c.res.statusText,
    });
  }
};
