import { lambdaClient } from '@/libs/trpc/client';
import type { AgentShareConfigInput } from '@/server/routers/lambda/agentShare';

class AgentShareService {
  async disableShare(agentId: string) {
    return lambdaClient.agentShare.disableShare.mutate({ agentId });
  }

  async enableShare(agentId: string) {
    return lambdaClient.agentShare.enableShare.mutate({ agentId });
  }

  async getShareStatus(agentId: string) {
    return lambdaClient.agentShare.getShareStatus.query({ agentId });
  }

  async getSharedAgent(shareId: string) {
    return lambdaClient.share.getSharedAgent.query({ shareId });
  }

  async updateShareConfig(agentId: string, config: AgentShareConfigInput) {
    return lambdaClient.agentShare.updateShareConfig.mutate({ agentId, config });
  }

  async updateVisibility(agentId: string, visibility: 'link' | 'private') {
    return lambdaClient.agentShare.updateVisibility.mutate({ agentId, visibility });
  }
}

export const agentShareService = new AgentShareService();
