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

  adminGetUserAdvancedModelAccess = (userId: string) =>
    lambdaClient.usage.adminGetUserAdvancedModelAccess.query({ userId });

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

  adminSetUserAdvancedModelAccess = (
    userId: string,
    access: Array<{ model: string; provider: string }>,
  ) => lambdaClient.usage.adminSetUserAdvancedModelAccess.mutate({ access, userId });

  adminGetUsageByUser = (userId: string, mo?: string) =>
    lambdaClient.usage.adminGetUsageByUser.query({ mo, userId });

  adminGetUsageByDepartmentDetail = (department: string, mo?: string) =>
    lambdaClient.usage.adminGetUsageByDepartmentDetail.query({ department, mo });

  adminGetUsageByDepartment = (mo?: string) =>
    lambdaClient.usage.adminGetUsageByDepartment.query({ mo });

  getMyAdvancedModelAccess = () => lambdaClient.usage.getMyAdvancedModelAccess.query();
}

export const usageService = new UsageService();
