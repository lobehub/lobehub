import { lambdaClient } from '@/libs/trpc/client';

class SharedAgentService {
  list = () => lambdaClient.sharedAgent.list.query();

  listAll = () => lambdaClient.sharedAgent.listAll.query();

  create = (data: {
    title?: string | null;
    description?: string | null;
    avatar?: string | null;
    backgroundColor?: string | null;
    systemRole?: string | null;
    model?: string | null;
    provider?: string | null;
    enabled?: boolean;
    sort?: number;
  }) => lambdaClient.sharedAgent.create.mutate(data);

  update = (id: string, value: Parameters<typeof this.create>[0]) =>
    lambdaClient.sharedAgent.update.mutate({ id, value });

  delete = (id: string) => lambdaClient.sharedAgent.delete.mutate({ id });

  toggleEnabled = (id: string, enabled: boolean) =>
    lambdaClient.sharedAgent.toggleEnabled.mutate({ id, enabled });
}

export const sharedAgentService = new SharedAgentService();
