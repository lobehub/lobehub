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
