import {
  type AgentCreateResponse,
  type AgentItemDetail,
  type AgentListResponse,
} from '@lobehub/market-sdk';

import { lambdaClient } from '@/libs/trpc/client';

interface GetOwnAgentsParams {
  page?: number;
  pageSize?: number;
}

export class MarketApiService {
  /**
   * @deprecated This method is no longer needed as authentication is now handled
   * automatically through tRPC middleware. Keeping for backward compatibility.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setAccessToken(_token: string) {
    // No-op: Authentication is now handled through tRPC authedProcedure middleware
  }

  // Create new agent
  async createAgent(agentData: {
    homepage?: string;
    identifier: string;
    isFeatured?: boolean;
    name: string;
    status?: 'published' | 'unpublished' | 'archived' | 'deprecated';
    tokenUsage?: number;
    visibility?: 'public' | 'private' | 'internal';
  }): Promise<AgentCreateResponse> {
    return lambdaClient.market.agent.createAgent.mutate(agentData);
  }

  // Get agent detail by identifier
  async getAgentDetail(identifier: string): Promise<AgentItemDetail> {
    return lambdaClient.market.agent.getAgentDetail.query({
      identifier,
    }) as Promise<AgentItemDetail>;
  }

  // Check if agent exists (returns true if exists, false if not)
  async checkAgentExists(identifier: string): Promise<boolean> {
    try {
      await this.getAgentDetail(identifier);
      return true;
    } catch {
      return false;
    }
  }

  // Create agent version
  async createAgentVersion(versionData: {
    a2aProtocolVersion?: string;
    avatar?: string;
    category?: string;
    changelog?: string;
    config?: Record<string, any>;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    description?: string;
    documentationUrl?: string;
    extensions?: Record<string, any>[];
    hasPushNotifications?: boolean;
    hasStateTransitionHistory?: boolean;
    hasStreaming?: boolean;
    identifier: string;
    interfaces?: Record<string, any>[];
    name?: string;
    preferredTransport?: string;
    providerId?: number;
    securityRequirements?: Record<string, any>[];
    securitySchemes?: Record<string, any>;
    setAsCurrent?: boolean;
    summary?: string;
    supportsAuthenticatedExtendedCard?: boolean;
    tokenUsage?: number;
    url?: string;
  }) {
    return lambdaClient.market.agent.createAgentVersion.mutate(versionData);
  }

  // Publish agent (make it visible in marketplace)
  async publishAgent(identifier: string): Promise<void> {
    await lambdaClient.market.agent.publishAgent.mutate({ identifier });
  }

  // Unpublish agent (hide from marketplace, can be republished)
  async unpublishAgent(identifier: string): Promise<void> {
    await lambdaClient.market.agent.unpublishAgent.mutate({ identifier });
  }

  // Deprecate agent (permanently hide, cannot be republished)
  async deprecateAgent(identifier: string): Promise<void> {
    await lambdaClient.market.agent.deprecateAgent.mutate({ identifier });
  }

  // Get own agents (requires authentication)
  async getOwnAgents(params?: GetOwnAgentsParams): Promise<AgentListResponse> {
    return lambdaClient.market.agent.getOwnAgents.query(params) as Promise<AgentListResponse>;
  }
}

export const marketApiService = new MarketApiService();
