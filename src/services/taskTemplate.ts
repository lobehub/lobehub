import { lambdaClient } from '@/libs/trpc/client';

class TaskTemplateService {
  dismiss = async (templateId: string) => {
    return lambdaClient.taskTemplate.dismiss.mutate({ templateId });
  };

  listDailyRecommend = async (interestKeys: string[]) => {
    return lambdaClient.taskTemplate.listDailyRecommend.query({ interestKeys });
  };
}

export const taskTemplateService = new TaskTemplateService();
