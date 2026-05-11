import { lambdaClient } from '@/libs/trpc/client/lambda';

class TaskTemplateService {
  dismiss = async (templateId: string) => {
    return lambdaClient.taskTemplate.dismiss.mutate({ templateId });
  };

  listDailyRecommend = async (
    interestKeys: string[],
    options: { count?: number; refreshSeed?: string } = {},
  ) => {
    return lambdaClient.taskTemplate.listDailyRecommend.query({
      count: options.count,
      interestKeys,
      refreshSeed: options.refreshSeed,
    });
  };

  recordCreated = async (templateId: string) => {
    return lambdaClient.taskTemplate.recordCreated.mutate({ templateId });
  };
}

export const taskTemplateService = new TaskTemplateService();
