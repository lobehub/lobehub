// Next hands route handlers a Proxy around the request. On Node 24+ (undici 7)
// `new Request(proxy, init)` reads a private field off the proxy and throws,
// which Hono's body-limit does for any body that arrives without content-length.
export const toPlainRequest = (request: Request): Request => {
  const { body } = request;
  return new Request(request.url, {
    body,
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);
};
