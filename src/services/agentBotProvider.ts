import { lambdaClient } from '@/libs/trpc/client';

import type { BotRuntimeStatusSnapshot } from '../types/botRuntimeStatus';

class AgentBotProviderService {
  listPlatforms = async () => {
    return lambdaClient.agentBotProvider.listPlatforms.query();
  };

  getByAgentId = async (agentId: string) => {
    return lambdaClient.agentBotProvider.getByAgentId.query({ agentId });
  };

  getRuntimeStatus = async (params: {
    applicationId: string;
    platform: string;
  }): Promise<BotRuntimeStatusSnapshot> => {
    return lambdaClient.agentBotProvider.getRuntimeStatus.query(params);
  };

  create = async (params: {
    agentId: string;
    applicationId: string;
    credentials: Record<string, string>;
    enabled?: boolean;
    platform: string;
    settings?: Record<string, unknown>;
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
      settings?: Record<string, unknown>;
    },
  ) => {
    return lambdaClient.agentBotProvider.update.mutate({ id, ...params });
  };

  delete = async (id: string) => {
    return lambdaClient.agentBotProvider.delete.mutate({ id });
  };

  connectBot = async (params: {
    applicationId: string;
    platform: string;
  }): Promise<{ status: 'queued' | 'started' }> => {
    return lambdaClient.agentBotProvider.connectBot.mutate(params);
  };

  testConnection = async (params: { applicationId: string; platform: string }) => {
    return lambdaClient.agentBotProvider.testConnection.mutate(params);
  };

  wechatGetQrCode = async () => {
    return lambdaClient.agentBotProvider.wechatGetQrCode.mutate();
  };

  wechatPollQrStatus = async (qrcode: string) => {
    return lambdaClient.agentBotProvider.wechatPollQrStatus.query({ qrcode });
  };
}

export const agentBotProviderService = new AgentBotProviderService();
