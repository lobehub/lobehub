import { lambdaClient } from '@/libs/trpc/client';
import type { AgentShareConfigPatchInput } from '@/server/routers/lambda/agentShare';

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
    // The visitor page renders its own login prompt on UNAUTHORIZED; opt out of
    // the global 401 handler so it does not hard-redirect visitors to /signin.
    return lambdaClient.share.getSharedAgent.query(
      { shareId },
      { context: { showNotification: false } },
    );
  }

  async updateShareConfig(agentId: string, config: AgentShareConfigPatchInput) {
    return lambdaClient.agentShare.updateShareConfig.mutate({ agentId, config });
  }

  async updateVisibility(agentId: string, visibility: 'link' | 'private') {
    return lambdaClient.agentShare.updateVisibility.mutate({ agentId, visibility });
  }
}

export const agentShareService = new AgentShareService();
