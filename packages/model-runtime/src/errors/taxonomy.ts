/**
 * Error classification taxonomy.
 *
 * The taxonomy is orthogonal to the `AgentRuntimeErrorType` code. A code says
 * *what* the error is; the taxonomy says *how to react to it*.
 *
 * Four dimensions:
 *
 * - `category` — semantic bucket for dashboard slicing.
 * - `severity` — log level / alerting hint.
 * - `attribution` — who owns the fix:
 *     - `user`    — user changes their key / prompt / model / subscription and it works.
 *     - `provider`— upstream provider's problem; neither user nor lobehub can fix it directly.
 *     - `harness` — our (lobehub / model-runtime / agent-gateway) bug or shortcoming.
 *     - `system`  — infra / network / OS layer.
 * - `countAsFailure` — whether this error should be counted toward operational
 *   failure metrics. User-side errors are generally false (they're expected).
 */
export type ErrorCategory =
  | 'auth' // credentials, account, permission
  | 'quota' // balance, billing, plan limits
  | 'capacity' // rate-limit, overload, no-channel
  | 'request' // input format, context-window, capability
  | 'safety' // content moderation
  | 'network' // timeout, connection
  | 'stream' // streaming-protocol-level failures
  | 'provider' // generic provider biz error (catch-all)
  | 'config'; // user misconfiguration

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ErrorAttribution = 'user' | 'provider' | 'harness' | 'system';

/**
 * Mapping of category → leading digit of the `numericId`.
 *
 * The 4-digit `numericId` (surfaced as `E1001`, `E2902`, …) is structured:
 *
 *   digit 1  — category bucket (this map; 1 = auth … 9 = config)
 *   digit 2  — **tier**: `0` = open-source / self-host runtime,
 *              `9` = LobeHub Cloud-only (see `CLOUD_TIER_DIGIT`)
 *   digits 3-4 — sequence within the (category, tier) bucket
 *
 * So `E2001` is the OSS quota code `InsufficientQuota`, while `E2902` is the
 * Cloud-only quota code `InsufficientBudgetForModel`. The tier digit lets a
 * dashboard slice "Cloud platform errors" without a separate category, and
 * keeps the category leading-digit invariant intact.
 *
 * The `numericId` is **append-only**: once published, a (code, id) pair never
 * changes, even if the string `code` is later renamed. This is the contract
 * that lets `E1001` show up in support tickets / docs / external SDKs as a
 * stable reference.
 */
export const CATEGORY_NUMERIC_PREFIX: Record<ErrorCategory, number> = {
  auth: 1,
  quota: 2,
  capacity: 3,
  request: 4,
  safety: 5,
  network: 6,
  stream: 7,
  provider: 8,
  config: 9,
};

/**
 * The `numericId`'s second digit marks the tier. Cloud-only codes (emitted
 * solely by the managed LobeHub Cloud gateway, e.g. `InsufficientBudgetForModel`)
 * use `9`; everything in the open-source runtime uses `0`.
 */
export const CLOUD_TIER_DIGIT = 9;
