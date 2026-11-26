import dayjs from 'dayjs';

import { type AgentUsageParams, statsActions, statsSelectors, useStatsStore } from '@/store/stats';
import { type AgentUsageGranularity } from '@/types/usage/usageRecord';

export type TimeRange = '7d' | '30d' | '90d';

export const RANGE_DAYS: Record<TimeRange, number> = {
  '30d': 30,
  '7d': 7,
  '90d': 90,
};

/** The usage read of one agent over the last `range` days, ending today. */
export const agentUsageParams = (
  agentId: string,
  range: TimeRange,
  granularity: AgentUsageGranularity,
): AgentUsageParams => ({
  agentId,
  endAt: dayjs().endOf('day').format('YYYY-MM-DD'),
  granularity,
  startAt: dayjs()
    .subtract(RANGE_DAYS[range] - 1, 'day')
    .startOf('day')
    .format('YYYY-MM-DD'),
});

/** The tab's initial range and granularity, also seeded by `agentUsageLoader`. */
export const DEFAULT_RANGE: TimeRange = '30d';
export const DEFAULT_GRANULARITY: AgentUsageGranularity = 'day';

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
  const params = agentId ? agentUsageParams(agentId, range, granularity) : null;
  const { error, revalidate } = statsActions.useFetchAgentUsage(params);
  const data = useStatsStore(statsSelectors.agentUsage(params));

  return { data, error, isLoading: !!params && !data, revalidate };
};
