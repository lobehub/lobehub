import { lambdaClient } from '@/libs/trpc/client';

class BriefService {
  addComment = async (taskId: string, content: string, briefId?: string) => {
    return lambdaClient.task.addComment.mutate({ briefId, content, id: taskId });
  };

  listUnresolved = async () => {
    return lambdaClient.brief.listUnresolved.query();
  };

  markRead = async (id: string) => {
    return lambdaClient.brief.markRead.mutate({ id });
  };

  resolve = async (id: string, params?: { action?: string; comment?: string }) => {
    return lambdaClient.brief.resolve.mutate({ id, ...params });
  };
}

export const briefService = new BriefService();
