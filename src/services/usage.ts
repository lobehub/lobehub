import { lambdaClient } from '@/libs/trpc/client';
import { type AgentUsageGranularity } from '@/types/usage/usageRecord';

class UsageService {
  findByMonth = async (mo?: string) => {
    return lambdaClient.usage.findByMonth.query({ mo });
  };

  findAndGroupByDay = async (mo?: string) => {
    return lambdaClient.usage.findAndGroupByDay.query({ mo });
  };

  /**
   * Rich usage + cost stats for a single agent over a date range.
   */
  getAgentUsageStats = async (params: {
    agentId: string;
    endAt: string;
    granularity: AgentUsageGranularity;
    startAt: string;
  }) => {
    return lambdaClient.usage.getAgentUsageStats.query(params);
  };
}

export const usageService = new UsageService();
