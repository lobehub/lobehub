/**
 * Heterogeneous (external CLI agent) error taxonomy.
 *
 * Mirrors the model-runtime taxonomy (`@lobechat/model-runtime/errors`) in
 * shape and intent, but classifies a different failure surface: instead of one
 * HTTP call to a model provider, a heterogeneous run is a **local CLI process**
 * that streams events and can die at any of four layers — spawn, transport,
 * the provider behind the CLI, or the run's own lifecycle.
 *
 * Two identifiers, deliberately separate:
 *
 * - `kind` — the fine-grained classification (this module). It is what
 *   dashboards slice on and what we reason about.
 * - `guideCode` — the coarse code actually emitted on the wire as
 *   `HeterogeneousTerminalErrorData.code`, because the client renders exactly
 *   four status-guide cards and hardwires behavior to them (notably
 *   `overloaded` → capped auto-retry in `useHeterogeneousAutoRetry`).
 *
 * Keeping them separate is what lets `network_drop` and `server_overloaded`
 * stay distinct rows in the taxonomy while sharing one retry contract on
 * screen. Collapsing them into a single field is what previously made
 * "transient transport failure" indistinguishable from "provider is busy".
 *
 * Four dimensions, same meaning as model-runtime:
 *
 * - `category` — semantic bucket for dashboard slicing.
 * - `severity` — log level / alerting hint.
 * - `attribution` — who owns the fix:
 *     - `user`     — user signs in / waits for a reset / fixes their input.
 *     - `provider` — the model provider behind the CLI; neither user nor we
 *                    can fix it directly.
 *     - `harness`  — our bug (LobeHub, the adapter, the spawn/resume plumbing)
 *                    or the CLI's own.
 *     - `system`   — machine / network / OS layer.
 * - `countAsFailure` — whether it should count toward operational failure
 *   metrics. User-side and user-initiated outcomes are false: a usage limit or
 *   a deliberate stop is an expected outcome, not an incident.
 */
export type HeteroErrorCategory =
  | 'auth' // credentials, login state
  | 'quota' // plan windows, credits, balance
  | 'capacity' // upstream overload / transient throttle
  | 'request' // malformed request, unsupported input
  | 'network' // transport drop, stall, timeout
  | 'lifecycle' // the run ended without completing (stopped, max turns)
  | 'session' // resume / conversation continuity
  | 'environment' // the CLI itself: missing, unusable
  | 'provider'; // provider-side biz error + catch-all

export type HeteroErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type HeteroErrorAttribution = 'user' | 'provider' | 'harness' | 'system';

/**
 * The four codes the client can actually render a dedicated status guide for.
 * Anything else falls back to the generic error card, which shows the message
 * verbatim — acceptable only when the message is self-explanatory.
 *
 * Must stay in sync with `HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES`
 * (`src/features/Conversation/Error/heterogeneous.ts`) and
 * `STATUS_GUIDE_ERROR_CODES` (`../spawn/classifyProcessFailure.ts`).
 */
export type HeteroGuideCode =
  'auth_required' | 'cli_not_found' | 'overloaded' | 'rate_limit' | 'working_directory_not_found';

/**
 * Mapping of category → leading digit of the `numericId`.
 *
 * The 4-digit `numericId` is surfaced as `H<numericId>` (e.g. `H2001`) — the
 * `H` namespace keeps it from colliding with model-runtime's `E<numericId>`,
 * which numbers a different set of categories.
 *
 *   digit 1    — category bucket (this map)
 *   digits 2-4 — sequence within the category
 *
 * Append-only: once published, a (kind, numericId) pair never changes, so it
 * can be referenced from support tickets and dashboards long-term.
 */
export const HETERO_CATEGORY_NUMERIC_PREFIX: Record<HeteroErrorCategory, number> = {
  auth: 1,
  quota: 2,
  capacity: 3,
  request: 4,
  network: 5,
  lifecycle: 6,
  session: 7,
  environment: 8,
  provider: 9,
};
