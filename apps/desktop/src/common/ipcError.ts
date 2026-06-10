/**
 * IPC error envelope.
 *
 * Electron's `ipcRenderer.invoke` rebuilds a thrown handler error from a
 * *string* on the renderer side (roughly `new Error("Error invoking remote
 * method '<channel>': " + String(mainError))`), so the original error object —
 * including a non-enumerable `cause` — never crosses the boundary. The real
 * failure reason (e.g. undici's `ENOTFOUND` / `ECONNREFUSED` hidden under a
 * generic `TypeError: fetch failed`) is therefore lost.
 *
 * To preserve it, the main process *returns* a clone-safe envelope (a plain
 * object) instead of throwing, and the preload `invoke` wrapper rebuilds a real
 * `Error` (with `cause`) from the envelope before re-throwing — keeping the
 * existing "promise rejects on failure" contract for every caller.
 */

const IPC_ERROR_MARKER = '__lobeIpcError__';

/** Bound recursion on a deliberately malicious / cyclic `cause` chain. */
const MAX_CAUSE_DEPTH = 5;

export interface SerializedIpcError {
  cause?: SerializedIpcError | string;
  /** Node/undici machine-readable reason (`ENOTFOUND`, `ECONNREFUSED`, …). */
  code?: unknown;
  message: string;
  name: string;
  stack?: string;
}

export interface IpcErrorEnvelope {
  error: SerializedIpcError;
  [IPC_ERROR_MARKER]: true;
}

const serializeError = (value: unknown, depth: number): SerializedIpcError => {
  if (value instanceof Error) {
    const serialized: SerializedIpcError = { message: value.message, name: value.name };

    if (typeof value.stack === 'string') serialized.stack = value.stack;

    const { code } = value as { code?: unknown };
    if (code !== undefined) serialized.code = code;

    if (value.cause !== undefined && value.cause !== null && depth < MAX_CAUSE_DEPTH) {
      serialized.cause =
        value.cause instanceof Error ? serializeError(value.cause, depth + 1) : String(value.cause);
    }

    return serialized;
  }

  return { message: typeof value === 'string' ? value : String(value), name: 'Error' };
};

/** Build a clone-safe envelope from a thrown value (main process). */
export const toIpcErrorEnvelope = (value: unknown): IpcErrorEnvelope => ({
  [IPC_ERROR_MARKER]: true,
  error: serializeError(value, 0),
});

/** Detect an envelope produced by {@link toIpcErrorEnvelope} (preload). */
export const isIpcErrorEnvelope = (value: unknown): value is IpcErrorEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>)[IPC_ERROR_MARKER] === true;

const reviveError = (serialized: SerializedIpcError): Error => {
  const cause =
    serialized.cause === undefined
      ? undefined
      : typeof serialized.cause === 'string'
        ? serialized.cause
        : reviveError(serialized.cause);

  const error = new Error(serialized.message, cause === undefined ? undefined : { cause });
  error.name = serialized.name;
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  if (serialized.code !== undefined) (error as { code?: unknown }).code = serialized.code;

  return error;
};

/** Rebuild a real `Error` (with `cause`) from an envelope (preload). */
export const fromIpcErrorEnvelope = (envelope: IpcErrorEnvelope): Error =>
  reviveError(envelope.error);
