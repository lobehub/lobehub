import dayjs from 'dayjs';

import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';
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
 * last N days (ending today).
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

  return useClientDataSWR(
    agentId ? statsKeys.agentUsageStat(agentId, startAt, endAt, granularity) : null,
    async () => usageService.getAgentUsageStats({ agentId, endAt, granularity, startAt }),
  );
};
