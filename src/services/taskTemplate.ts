import { lambdaClient } from '@/libs/trpc/client';

class TaskTemplateService {
  listDailyRecommend = async (interestKeys: string[]) => {
    return lambdaClient.taskTemplate.listDailyRecommend.query({ interestKeys });
  };
}

export const taskTemplateService = new TaskTemplateService();
