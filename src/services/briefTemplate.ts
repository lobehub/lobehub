import { lambdaClient } from '@/libs/trpc/client';

class BriefTemplateService {
  listDailyRecommend = async (interestKeys: string[]) => {
    return lambdaClient.briefTemplate.listDailyRecommend.query({ interestKeys });
  };
}

export const briefTemplateService = new BriefTemplateService();
