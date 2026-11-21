// Edge ids set before the app runs, most specific first: Vercel's id names the
// region and function invocation, Cloudflare's Ray ID exists for every request
// that crossed the edge, and `x-request-id` covers self-hosted reverse proxies.
const REQUEST_ID_HEADERS = ['x-vercel-id', 'cf-ray', 'x-request-id'] as const;

/**
 * A lambda response whose body is not JSON — a gateway/CDN error page (502,
 * 504, function timeout, maintenance), an SPA HTML fallback, or a proxy's plain
 * text error. The tRPC client would otherwise fail `res.json()` and drop the
 * response, leaving only `Unexpected token '<', "<!doctype "...` with no status
 * and no id to look the failure up by.
 */
export class UnreadableServerResponseError extends Error {
  readonly requestId?: string;
  readonly status: number;

  constructor({ requestId, status }: { requestId?: string; status: number }) {
    super(
      `Server returned a non-JSON response (HTTP ${status}${requestId ? `, request id ${requestId}` : ''})`,
    );
    this.name = 'UnreadableServerResponseError';
    this.requestId = requestId;
    this.status = status;
  }
}

const getRequestId = (headers: Headers) => {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
};

/**
 * Return an `UnreadableServerResponseError` when the body cannot be parsed as
 * JSON. A tRPC server always answers JSON, so the body is only read here when
 * the content type already says otherwise — normal responses are untouched.
 */
export const detectUnreadableServerResponse = async (
  response: Response,
): Promise<UnreadableServerResponseError | undefined> => {
  if (response.headers.get('content-type')?.includes('json')) return;

  try {
    JSON.parse(await response.clone().text());
    return;
  } catch {
    return new UnreadableServerResponseError({
      requestId: getRequestId(response.headers),
      status: response.status,
    });
  }
};

/** Find the error on a thrown value or on its `cause` (tRPC wraps link errors). */
export const findUnreadableServerResponseError = (
  error: unknown,
): UnreadableServerResponseError | undefined => {
  if (error instanceof UnreadableServerResponseError) return error;

  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  if (cause instanceof UnreadableServerResponseError) return cause;
};
