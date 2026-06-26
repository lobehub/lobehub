import { lambdaClient } from '@/libs/trpc/client';

class UsageService {
  findByMonth = async (mo?: string) => {
    return lambdaClient.usage.findByMonth.query({ mo });
  };

  findAndGroupByDay = async (mo?: string) => {
    return lambdaClient.usage.findAndGroupByDay.query({ mo });
  };

  /**
   * Usage grouped by day for a single agent, scoped to the given month.
   */
  findAndGroupByDayForAgent = async (agentId: string, mo?: string) => {
    return lambdaClient.usage.findAndGroupByDay.query({ agentId, mo });
  };
}

export const usageService = new UsageService();
