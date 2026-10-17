import { lambdaClient } from '@/libs/trpc/client';

class LinearService {
  disconnect = async (connectionId: string) =>
    lambdaClient.linear.disconnect.mutate({ connectionId });

  getConfig = async () => lambdaClient.linear.getConfig.query();

  listConnections = async () => lambdaClient.linear.listConnections.query();
}

export const linearService = new LinearService();
