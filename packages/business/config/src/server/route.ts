// set timeout to about 5 minutes, and give 2s padding time.
// Can be overridden via the ASYNC_TASK_TIMEOUT_SECONDS env var (in seconds);
// defaults to the original 298s so existing deployments are unaffected.
// Only a finite, positive value is accepted; any invalid input (non-numeric,
// zero, negative, Infinity, NaN) falls back to the default to avoid producing
// a non-positive timeout that would abort pending tasks immediately.
const DEFAULT_ASYNC_TASK_TIMEOUT_SECONDS = 60 * 5 - 2;

const parseAsyncTaskTimeoutSeconds = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_ASYNC_TASK_TIMEOUT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ASYNC_TASK_TIMEOUT_SECONDS;
  return parsed;
};

export const ASYNC_TASK_TIMEOUT =
  parseAsyncTaskTimeoutSeconds(process.env.ASYNC_TASK_TIMEOUT_SECONDS) * 1000;

// // trpc routes max duration
// export const TRPC_ASYNC_MAX_DURATION: number | undefined = undefined;
// export const TRPC_TOOLS_MAX_DURATION: number | undefined = undefined;

// export const WEBAPI_CHAT_MAX_DURATION: number = 300;
// export const WEBAPI_PLUGIN_GATEWAY_MAX_DURATION: number | undefined = undefined;
