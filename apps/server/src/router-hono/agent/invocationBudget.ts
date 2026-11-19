/**
 * The route's `maxDuration`: when the host kills this invocation, counted from
 * the start of the request. Must equal the deployment's `maxDuration` for
 * `/api/agent` (Cloud asserts it in a test): a larger value lets the host kill
 * a step mid-stream before the LLM deadline fires, leaving the call unbilled
 * while the upstream bills it, and the queue redelivering it from scratch.
 *
 * 1800s fits one maximum-length step: a 128k-token output at ~100 tok/s takes
 * about 1300s. The queue's response timeout must stay above this value, or it
 * redelivers a step that is still running.
 */
export const STEP_INVOCATION_MAX_DURATION_MS = 1_800_000;
