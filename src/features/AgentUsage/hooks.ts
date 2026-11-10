import dayjs from 'dayjs';

import { statsActions, statsSelectors, useStatsStore } from '@/store/stats';
import { type AgentUsageGranularity } from '@/types/usage/usageRecord';

export type TimeRange = '7d' | '30d' | '90d';

export const RANGE_DAYS: Record<TimeRange, number> = {
  '30d': 30,
  '7d': 7,
  '90d': 90,
};

/**
 * Fetch rich usage + cost stats for a single agent over the selected time range
 * and granularity. The range resolves to an inclusive `[startAt, endAt]` of the
 * last N days (ending today). Each range paints its last local copy on revisit
 * and revalidates in the background.
 */
export const useAgentUsageStats = (
  agentId: string,
  range: TimeRange,
  granularity: AgentUsageGranularity,
) => {
  const endAt = dayjs().endOf('day').format('YYYY-MM-DD');
  const startAt = dayjs()
    .subtract(RANGE_DAYS[range] - 1, 'day')
    .startOf('day')
    .format('YYYY-MM-DD');

  const params = agentId ? { agentId, endAt, granularity, startAt } : null;
  const { error, revalidate } = statsActions.useFetchAgentUsage(params);
  const data = useStatsStore(statsSelectors.agentUsage(params));

  return { data, error, isLoading: !!params && !data, revalidate };
};
