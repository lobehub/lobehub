import type { Context, Next } from 'hono';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const MAX_LENGTH = 128;

/**
 * Give every request an id, echoed in the `X-Request-Id` response header and
 * in every error body's `requestId`. A caller-supplied id is kept when it is a
 * short token, so a client can correlate its own logs with ours.
 *
 * Runs before authentication so even a 401 carries the id. The header is set
 * again after the handler because a route that returns a raw `Response` (relay
 * streams) bypasses the context's prepared headers.
 */
export const requestIdMiddleware = async (c: Context, next: Next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId =
    incoming && incoming.length <= MAX_LENGTH && /^[\w.:-]+$/.test(incoming)
      ? incoming
      : `req_${crypto.randomUUID().replaceAll('-', '')}`;

  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  await next();

  if (c.res.headers.get(REQUEST_ID_HEADER) === requestId) return;
  try {
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // Immutable headers (a proxied upstream response): re-wrap it.
    const headers = new Headers(c.res.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    c.res = new Response(c.res.body, {
      headers,
      status: c.res.status,
      statusText: c.res.statusText,
    });
  }
};
