import { lambdaClient } from '@/libs/trpc/client/lambda';

class TaskTemplateService {
  dismiss = async (templateId: number) => {
    return lambdaClient.taskTemplate.dismiss.mutate({ templateId });
  };

  listDailyRecommend = async (
    interestKeys: string[],
    options: { count?: number; locale?: string; refreshSeed?: string } = {},
  ) => {
    return lambdaClient.taskTemplate.listDailyRecommend.query({
      count: options.count,
      interestKeys,
      locale: options.locale,
      refreshSeed: options.refreshSeed,
    });
  };

  recordCreated = async (templateId: number) => {
    return lambdaClient.taskTemplate.recordCreated.mutate({ templateId });
  };
}

export const taskTemplateService = new TaskTemplateService();
