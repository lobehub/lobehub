/**
 * Limits shared by every inbound webhook kind (MCP Events subscriptions and generic webhooks).
 *
 * - Deliveries are counted per scope (a workspace, or one member's personal space) across all of
 *   its webhooks: one caller cannot flood the scope by spreading calls over many webhooks.
 * - Runs are counted per webhook in a short window: a burst of calls to one webhook cannot keep
 *   the Agent busy, while other webhooks of the scope keep their own allowance.
 */

/** Accepted deliveries per minute for each member of the scope (a personal space has one). */
export const DELIVERIES_PER_MINUTE_PER_MEMBER = 120;

/** Agent runs one webhook may start per {@link RUN_WINDOW_MS}. */
export const RUNS_PER_WINDOW = 30;
export const RUN_WINDOW_MS = 10 * 60_000;

/** The scope a webhook's deliveries are counted in. */
export const deliveryScopeOf = (row: { userId: string; workspaceId: string | null }) =>
  row.workspaceId ? `workspace:${row.workspaceId}` : `user:${row.userId}`;
