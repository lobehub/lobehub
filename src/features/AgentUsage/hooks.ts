import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';
import { type UsageLog } from '@/types/usage/usageRecord';

/**
 * Fetch the day-grouped usage logs for a single agent, scoped to a month.
 * `mo` is a `YYYY-MM` string; when omitted the server falls back to the
 * current month.
 */
export const useAgentUsage = (agentId: string, mo?: string) =>
  useClientDataSWR(agentId ? statsKeys.agentUsageStat(agentId, mo) : null, async () =>
    usageService.findAndGroupByDayForAgent(agentId, mo),
  );

export interface AgentUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  totalSpend: number;
  totalTokens: number;
}

/**
 * Roll up the day buckets into a single set of totals for the summary cards.
 */
export const summarizeUsage = (data?: UsageLog[]): AgentUsageSummary => {
  const empty: AgentUsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalRequests: 0,
    totalSpend: 0,
    totalTokens: 0,
  };
  if (!data || data.length === 0) return empty;

  return data.reduce((acc, log) => {
    acc.totalSpend += log.totalSpend || 0;
    acc.totalTokens += log.totalTokens || 0;
    acc.totalRequests += log.totalRequests || 0;
    for (const record of log.records ?? []) {
      acc.totalInputTokens += record.totalInputTokens || 0;
      acc.totalOutputTokens += record.totalOutputTokens || 0;
    }
    return acc;
  }, empty);
};

export interface ModelUsageRow {
  inputTokens: number;
  key: string;
  model: string;
  outputTokens: number;
  provider: string;
  requests: number;
  spend: number;
  totalTokens: number;
}

/**
 * Aggregate every per-message record by `(provider, model)` so we can render a
 * model breakdown table, sorted by total tokens descending.
 */
export const groupByModel = (data?: UsageLog[]): ModelUsageRow[] => {
  if (!data || data.length === 0) return [];

  const map = new Map<string, ModelUsageRow>();
  for (const log of data) {
    for (const record of log.records ?? []) {
      const model = record.model || 'unknown';
      const provider = record.provider || 'unknown';
      const key = `${provider}/${model}`;
      const row = map.get(key) ?? {
        inputTokens: 0,
        key,
        model,
        outputTokens: 0,
        provider,
        requests: 0,
        spend: 0,
        totalTokens: 0,
      };
      row.requests += 1;
      row.inputTokens += record.totalInputTokens || 0;
      row.outputTokens += record.totalOutputTokens || 0;
      row.totalTokens += record.totalTokens || 0;
      row.spend += record.spend || 0;
      map.set(key, row);
    }
  }

  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
};
