import { lambdaClient } from "@/libs/trpc/client";

class UsageService {
    findByMonth = async (mo?: string) => {
        return lambdaClient.usage.findByMonth.query({ mo });
    };

    findAndGroupByDay = async (mo?: string) => {
        return lambdaClient.usage.findAndGroupByDay.query({ mo });
    }
}

export const usageService = new UsageService();