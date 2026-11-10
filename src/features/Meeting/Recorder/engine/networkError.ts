const NETWORK_FAILURE =
  /failed to fetch|network ?error|network request failed|load failed|internet_disconnected/i;

/**
 * Whether a failed request means the connection is down rather than the
 * server refusing it. `navigator.onLine` alone is not enough: it stays `true`
 * behind a dead router or captive portal, so the error itself is checked too
 * (fetch / tRPC wrap the browser's `TypeError: Failed to fetch` as `cause`).
 */
export const isNetworkError = (error: unknown): boolean => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  let current = error as { cause?: unknown; message?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.message === 'string' && NETWORK_FAILURE.test(current.message)) return true;
    current = current.cause as typeof current;
  }
  return false;
};
