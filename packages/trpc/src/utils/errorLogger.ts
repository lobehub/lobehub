import type { TRPCError } from '@trpc/server';

/**
 * Routers can stamp this key on `error.cause` to tell the HTTP handler to
 * skip logging the error — used for expected user-channel 4xx failures
 * (e.g. input-completion provider rejections) that would otherwise pollute
 * error monitoring. Write it via `markSilentTRPCErrorLog` below; this file
 * is the single home for both halves of the contract.
 */
export const SILENT_TRPC_ERROR_LOG_KEY = '__lobeSilentTRPCErrorLog';

/**
 * Stamp the silent-log marker on an error so `createTRPCErrorLogger` skips
 * it. Best-effort: never throws, so it can't mask the original error.
 */
export const markSilentTRPCErrorLog = (error: unknown) => {
  if (!error || typeof error !== 'object') return;

  try {
    Object.defineProperty(error, SILENT_TRPC_ERROR_LOG_KEY, {
      configurable: true,
      value: true,
    });
  } catch {
    // Best-effort logging hint; never let it mask the original runtime error.
  }
};

const shouldSkipTRPCErrorLog = (cause: unknown): boolean =>
  Boolean(
    cause &&
    typeof cause === 'object' &&
    (cause as Record<string, unknown>)[SILENT_TRPC_ERROR_LOG_KEY],
  );

/**
 * Shared `onError` for tRPC fetch handlers. Skips UNAUTHORIZED (normal
 * client behavior — the frontend prompts the user to log in) and
 * silent-marked errors, so every user-facing endpoint applies the same log
 * hygiene. Used by the lambda / mobile / tools routes; the async route
 * intentionally keeps its own handler (background jobs have no user to
 * prompt, so UNAUTHORIZED there is a real anomaly worth logging).
 */
export const createTRPCErrorLogger =
  (endpoint: string) =>
  ({ error, path, type }: { error: TRPCError; path?: string; type: string }) => {
    if (error.code === 'UNAUTHORIZED') return;
    if (shouldSkipTRPCErrorLog(error.cause)) return;

    console.info(`Error in tRPC handler (${endpoint}) on path: ${path}, type: ${type}`);
    console.error(error);
  };
