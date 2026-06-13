const MAX_ERROR_DEPTH = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getRemoteModelFetchErrorMessage = (
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): string | undefined => {
  if (error === null || error === undefined) return;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  if (!isRecord(error)) return;
  if (seen.has(error) || depth >= MAX_ERROR_DEPTH) return;

  seen.add(error);

  for (const key of ['body', 'error', 'cause', 'response', 'detail', 'details', 'reason']) {
    const message = getRemoteModelFetchErrorMessage(error[key], seen, depth + 1);
    if (message) return message;
  }

  if (Array.isArray(error.errors)) {
    for (const item of error.errors) {
      const message = getRemoteModelFetchErrorMessage(item, seen, depth + 1);
      if (message) return message;
    }
  }

  if (typeof error.message === 'string' && error.message) return error.message;
  if (typeof error.status === 'number') return `HTTP ${error.status}`;
  if (typeof error.statusCode === 'number') return `HTTP ${error.statusCode}`;
};
