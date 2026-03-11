import { lambdaClient } from '@/libs/trpc/client';

class AgentBotProviderService {
  getByAgentId = async (agentId: string) => {
    return lambdaClient.agentBotProvider.getByAgentId.query({ agentId });
  };

  create = async (params: {
    agentId: string;
    applicationId: string;
    credentials: Record<string, string>;
    enabled?: boolean;
    platform: string;
  }) => {
    return lambdaClient.agentBotProvider.create.mutate(params);
  };

  update = async (
    id: string,
    params: {
      applicationId?: string;
      credentials?: Record<string, string>;
      enabled?: boolean;
      platform?: string;
    },
  ) => {
    return lambdaClient.agentBotProvider.update.mutate({ id, ...params });
  };

  delete = async (id: string) => {
    return lambdaClient.agentBotProvider.delete.mutate({ id });
  };

  connectBot = async (params: { applicationId: string; platform: string }) => {
    return lambdaClient.agentBotProvider.connectBot.mutate(params);
  };
}

export const agentBotProviderService = new AgentBotProviderService();
