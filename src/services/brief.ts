import { lambdaClient } from '@/libs/trpc/client';

class BriefService {
  delete = async (id: string) => {
    return lambdaClient.brief.delete.mutate({ id });
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
