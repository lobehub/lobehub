/**
 * Drops the empty body stream of a POST that declares no content type.
 *
 * Next.js gives every POST route request a non-null `body` stream, even when the client sent
 * nothing. better-call then requires a JSON content type and rejects the request with
 * 415 `UNSUPPORTED_MEDIA_TYPE`. Better Auth's own client sends such bodyless POSTs, notably
 * the `POST /get-session` refresh used by `deferSessionRefresh`, so without this every
 * session refresh fails and the user sees the "login status check failed" screen.
 * @see https://github.com/better-auth/better-auth/issues/6197
 */
export const stripEmptyUntypedBody = async (request: Request): Promise<Request> => {
  if (!request.body || request.headers.has('content-type')) return request;

  const body = await request.clone().arrayBuffer();
  if (body.byteLength > 0) return request;

  return new Request(request.url, {
    headers: request.headers,
    method: request.method,
    signal: request.signal,
  });
};
