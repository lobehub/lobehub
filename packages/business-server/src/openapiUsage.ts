/**
 * The caller's own spending allowance for the current cycle, in USD.
 *
 * `limit` is the denominator a "how much is left" indicator needs; it is
 * `null` when the allowance has no cap (or none is known), and then
 * `usedRatio` is `null` too.
 */
export interface OpenApiUsageQuota {
  limit: number | null;
  remaining: number | null;
  /** Next reset of a recurring allowance (ISO 8601), `null` when none recurs. */
  resetsAt: string | null;
  /** Where the allowance comes from: the user's own budgets, the workspace pool, or a member cap. */
  source: 'personal' | 'workspace_pool' | 'member_budget';
  used: number;
  /** `used / limit`, clamped to `0..1`. */
  usedRatio: number | null;
}

export interface OpenApiUsageSummary {
  available: boolean;
  currency: 'USD';
  daily: Array<{ date: string; value: number }>;
  period: { since: string; until: string };
  /** `null` when the deployment has no metered budget provider. */
  quota: OpenApiUsageQuota | null;
  remainingBalance: number | null;
  scope: 'personal' | 'workspace';
  spent: number;
  usageByType: Array<{ count: number | null; spend: number; type: string }>;
}

export interface GetOpenApiUsageParams {
  userId: string;
  workspaceId?: string;
}

/**
 * Optional usage/quota integration point. Self-hosted deployments without a
 * metered budget provider expose an unavailable, zero-usage summary.
 */
export const getOpenApiUsage = async (
  params: GetOpenApiUsageParams,
): Promise<OpenApiUsageSummary> => {
  const until = new Date();
  const since = new Date(until.getTime() - 29 * 86_400_000);

  return {
    available: false,
    currency: 'USD',
    daily: [],
    period: { since: since.toISOString(), until: until.toISOString() },
    quota: null,
    remainingBalance: null,
    scope: params.workspaceId ? 'workspace' : 'personal',
    spent: 0,
    usageByType: [],
  };
};
