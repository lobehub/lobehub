const DEFAULT_ABORT_MESSAGE = 'Agent execution aborted';

export function createAbortError(message = DEFAULT_ABORT_MESSAGE): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function getAbortError(signal?: AbortSignal, message = DEFAULT_ABORT_MESSAGE): Error {
  const reason = signal?.reason;

  if (reason instanceof Error) {
    if (reason.name === 'AbortError') return reason;
    return createAbortError(reason.message || message);
  }

  if (typeof reason === 'string' && reason.length > 0) {
    return createAbortError(reason);
  }

  return createAbortError(message);
}

export function throwIfAborted(signal?: AbortSignal, message = DEFAULT_ABORT_MESSAGE): void {
  if (!signal?.aborted) return;

  throw getAbortError(signal, message);
}

export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}
