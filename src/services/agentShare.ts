import { lambdaClient } from '@/libs/trpc/client';
import type {
  AgentShareConfigInput,
  AgentShareConfigPatchInput,
} from '@/server/routers/lambda/agentShare';

class AgentShareService {
  async disableShare(agentId: string) {
    return lambdaClient.agentShare.disableShare.mutate({ agentId });
  }

  async enableShare(agentId: string, visibility?: 'private' | 'link') {
    return lambdaClient.agentShare.enableShare.mutate({ agentId, visibility });
  }

  /** Owner-only aggregate usage (views, visitors, conversations, spend). */
  async getShareStats(agentId: string) {
    return lambdaClient.agentShare.getShareStats.query({ agentId });
  }

  async getShareStatus(agentId: string) {
    return lambdaClient.agentShare.getShareStatus.query({ agentId });
  }

  /** Resolve a share's visitor-facing metadata, by its custom slug or its raw share id. */
  async getSharedAgent(slugOrId: string) {
    // The visitor page renders its own login prompt on UNAUTHORIZED; opt out of
    // the global 401 handler so it does not hard-redirect visitors to /signin.
    return lambdaClient.share.getSharedAgent.query(
      { slugOrId },
      { context: { showNotification: false } },
    );
  }

  async updateShareConfig(agentId: string, config: AgentShareConfigPatchInput) {
    return lambdaClient.agentShare.updateShareConfig.mutate({ agentId, config });
  }

  /**
   * Update the share's custom URL slug, or clear it with `null`. Throws
   * `CONFLICT` if another share already claims it.
   */
  async updateSlug(agentId: string, slug: string | null) {
    return lambdaClient.agentShare.updateSlug.mutate({ agentId, slug });
  }

  async updateVisibility(agentId: string, visibility: 'link' | 'private') {
    return lambdaClient.agentShare.updateVisibility.mutate({ agentId, visibility });
  }
}

export const agentShareService = new AgentShareService();
export type { AgentShareConfigInput, AgentShareConfigPatchInput };
