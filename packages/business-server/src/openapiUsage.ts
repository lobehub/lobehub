export interface OpenApiUsageSummary {
  available: boolean;
  currency: 'USD';
  daily: Array<{ date: string; value: number }>;
  period: { since: string; until: string };
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
    remainingBalance: null,
    scope: params.workspaceId ? 'workspace' : 'personal',
    spent: 0,
    usageByType: [],
  };
};
