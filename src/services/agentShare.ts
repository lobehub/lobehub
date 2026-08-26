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

  /**
   * `trackView` defaults to `true` (a real page visit). Pass `false` for a
   * status-only re-check (e.g. re-validating budget after the owner tops up)
   * so it does not inflate the share's page-view count.
   */
  async getSharedAgent(shareId: string, trackView = true) {
    // The visitor page renders its own login prompt on UNAUTHORIZED; opt out of
    // the global 401 handler so it does not hard-redirect visitors to /signin.
    return lambdaClient.share.getSharedAgent.query(
      { shareId, trackView },
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
