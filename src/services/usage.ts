import { lambdaClient } from '@/libs/trpc/client';

class UsageService {
  findByMonth = async (mo?: string) => {
    return lambdaClient.usage.findByMonth.query({ mo });
  };

  findAndGroupByDay = async (mo?: string) => {
    return lambdaClient.usage.findAndGroupByDay.query({ mo });
  };

  isAdmin = async () => {
    return lambdaClient.usage.isAdmin.query();
  };

  adminFindByMonth = async (mo?: string) => {
    return lambdaClient.usage.adminFindByMonth.query({ mo });
  };

  adminFindAndGroupByDay = async (mo?: string) => {
    return lambdaClient.usage.adminFindAndGroupByDay.query({ mo });
  };

  checkQuota = () => lambdaClient.usage.checkQuota.query();

  adminGetAllUserQuotas = () => lambdaClient.usage.adminGetAllUserQuotas.query();

  adminGetAllDepartmentQuotas = () => lambdaClient.usage.adminGetAllDepartmentQuotas.query();

  adminSetUserQuota = (
    userId: string,
    limits: {
      dailyCostLimit: number | null;
      monthlyCostLimit: number | null;
      dailyTokenLimit: number | null;
      monthlyTokenLimit: number | null;
    },
  ) => lambdaClient.usage.adminSetUserQuota.mutate({ userId, ...limits });

  adminSetDepartmentQuota = (
    department: string,
    limits: {
      dailyCostLimit: number | null;
      monthlyCostLimit: number | null;
      dailyTokenLimit: number | null;
      monthlyTokenLimit: number | null;
    },
  ) => lambdaClient.usage.adminSetDepartmentQuota.mutate({ department, ...limits });

  adminGetUsageByDepartment = (mo?: string) =>
    lambdaClient.usage.adminGetUsageByDepartment.query({ mo });
}

export const usageService = new UsageService();
