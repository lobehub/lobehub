/**
 * Options for normalizing a Response so it can be consumed by the platform runtime.
 */
export interface EnsureNodeResponseOptions {
  /**
   * Force update the cache-control header, usually to disable caching for APIs.
   */
  cacheControl?: string;
  /**
   * Sets a default content-type header when the original Response omitted it.
   */
  defaultContentType?: string;
  /**
   * Force buffering even if a readable body stream exists.
   */
  forceBuffering?: boolean;
}

/**
 * Checks whether a value structurally matches the minimal Response interface.
 */
export const isResponseLike = (value: unknown): value is Response => {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Response>;

  return (
    typeof candidate.arrayBuffer === 'function' &&
    !!candidate.headers &&
    typeof (candidate.headers as Headers).get === 'function' &&
    typeof candidate.status === 'number' &&
    typeof candidate.statusText === 'string'
  );
};

/**
 * Re-wraps an arbitrary Response-like object into the platform Response implementation.
 *
 * This is required because some SDKs (e.g., OpenAI) ship their own Response shim
 * that is not recognized by Next.js when running in the Node.js runtime.
 */
export const ensureNodeResponse = async (
  source: Response,
  options: EnsureNodeResponseOptions = {},
) => {
  const headers = new Headers(source.headers);

  if (options.defaultContentType && !headers.has('content-type')) {
    headers.set('content-type', options.defaultContentType);
  }

  if (options.cacheControl) {
    headers.set('cache-control', options.cacheControl);
  }

  const body = !options.forceBuffering && source.body ? source.body : await source.arrayBuffer();

  return new Response(body, {
    headers,
    status: source.status,
    statusText: source.statusText,
  });
};

export interface CreateNodeResponseOptions {
  /**
   * Options applied when a Response-like error is thrown.
   */
  error?: EnsureNodeResponseOptions;
  /**
   * Callback when the resolved value is not Response-like.
   */
  onInvalidResponse?: (payload: unknown) => Response;
  /**
   * Callback when a non-Response error is thrown.
   */
  onNonResponseError?: (error: unknown) => Response;
  /**
   * Options applied when the resolved Response is normalized.
   */
  success?: EnsureNodeResponseOptions;
}

/**
 * Runs a response factory and ensures every exit path returns a platform Response.
 */
export const createNodeResponse = async <T>(
  responseCreator: () => Promise<T>,
  options: CreateNodeResponseOptions = {},
) => {
  try {
    const response = await responseCreator();

    if (!isResponseLike(response)) {
      if (options.onInvalidResponse) return options.onInvalidResponse(response);

      throw new Error('Expected a Response-like object from responseCreator.');
    }

    return ensureNodeResponse(response, options.success);
  } catch (error) {
    if (isResponseLike(error)) {
      return ensureNodeResponse(error, options.error);
    }

    if (options.onNonResponseError) return options.onNonResponseError(error);

    throw error;
  }
};
