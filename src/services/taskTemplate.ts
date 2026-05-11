import { lambdaClient } from '@/libs/trpc/client/lambda';

class TaskTemplateService {
  dismiss = async (templateId: string) => {
    return lambdaClient.taskTemplate.dismiss.mutate({ templateId });
  };

  listDailyRecommend = async (interestKeys: string[], refreshSeed?: string) => {
    return lambdaClient.taskTemplate.listDailyRecommend.query({ interestKeys, refreshSeed });
  };

  recordCreated = async (templateId: string) => {
    return lambdaClient.taskTemplate.recordCreated.mutate({ templateId });
  };
}

export const taskTemplateService = new TaskTemplateService();
