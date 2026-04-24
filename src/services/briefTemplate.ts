import { lambdaClient } from '@/libs/trpc/client';

class BriefTemplateService {
  listDailyRecommend = async (interestKeys: string[]) => {
    return lambdaClient.briefTemplate.listDailyRecommend.query({ interestKeys });
  };

  createFromTemplate = async (params: { prompt: string; templateId: string; title: string }) => {
    return lambdaClient.briefTemplate.createFromTemplate.mutate(params);
  };
}

export const briefTemplateService = new BriefTemplateService();
