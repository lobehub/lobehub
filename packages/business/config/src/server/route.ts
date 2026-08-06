// set timeout to about 5 minutes, and give 2s padding time.
// Can be overridden via the ASYNC_TASK_TIMEOUT_SECONDS env var (in seconds);
// defaults to the original 298s so existing deployments are unaffected.
export const ASYNC_TASK_TIMEOUT =
  (Number(process.env.ASYNC_TASK_TIMEOUT_SECONDS) || 60 * 5 - 2) * 1000;

// // trpc routes max duration
// export const TRPC_ASYNC_MAX_DURATION: number | undefined = undefined;
// export const TRPC_TOOLS_MAX_DURATION: number | undefined = undefined;

// export const WEBAPI_CHAT_MAX_DURATION: number = 300;
// export const WEBAPI_PLUGIN_GATEWAY_MAX_DURATION: number | undefined = undefined;
