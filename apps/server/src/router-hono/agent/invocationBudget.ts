/**
 * The route's `maxDuration`: when the host kills this invocation, counted from
 * the start of the request. Must equal the deployment's `maxDuration` for
 * `/api/agent` (Cloud asserts it in a test): a larger value lets the host kill
 * a step mid-stream before the LLM deadline fires, leaving the call unbilled
 * while the upstream bills it, and the queue redelivering it from scratch.
 */
export const STEP_INVOCATION_MAX_DURATION_MS = 800_000;
