import { type AgentItem, type LobeAgentConfig, type MetaData } from '@lobechat/types';
import { type PartialDeep } from 'type-fest';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Market agent model can be either a string or an object with model details
 */
type MarketAgentModel =
  | LobeAgentConfig['model']
  | {
      model: LobeAgentConfig['model'];
      parameters?: Partial<LobeAgentConfig['params']>;
      provider?: LobeAgentConfig['provider'];
    };

/**
 * Normalize market agent config to standard agent config.
 * Handles the case where market returns model as an object instead of string.
 */
const normalizeMarketAgentModel = (config?: PartialDeep<AgentItem>): PartialDeep<AgentItem> => {
  if (!config) return {};

  const model = config.model as MarketAgentModel | undefined;

  // If model is not an object, return config as-is
  if (typeof model !== 'object' || model === null) {
    return config;
  }

  // Extract model info and merge parameters
  const { model: modelName, provider: modelProvider, parameters } = model;
  const existingParams = (config.params ?? {}) as Record<string, any>;
  const mergedParams = { ...parameters, ...existingParams };

  return {
    ...config,
    model: modelName,
    params: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
    provider: config.provider ?? modelProvider,
  };
};

export interface CreateAgentParams {
  config?: PartialDeep<AgentItem>;
  groupId?: string;
}

export interface CreateAgentResult {
  agentId?: string;
  sessionId: string;
}

export interface CreateAgentOnlyParams {
  config?: PartialDeep<AgentItem>;
  groupId: string;
}

export interface CreateAgentOnlyResult {
  agentId: string;
}

class AgentService {
  /**
   * Check if an agent with the given marketIdentifier already exists
   */
  checkByMarketIdentifier = async (marketIdentifier: string): Promise<boolean> => {
    return lambdaClient.agent.checkByMarketIdentifier.query({ marketIdentifier });
  };

  /**
   * Get an agent by marketIdentifier
   * @returns agent id if exists, null otherwise
   */
  getAgentByMarketIdentifier = async (marketIdentifier: string): Promise<string | null> => {
    return lambdaClient.agent.getAgentByMarketIdentifier.query({ marketIdentifier });
  };

  /**
   * Get an agent by forkedFromIdentifier stored in params
   * @returns agent id if exists, null otherwise
   */
  getAgentByForkedFromIdentifier = async (forkedFromIdentifier: string): Promise<string | null> => {
    return lambdaClient.agent.getAgentByForkedFromIdentifier.query({ forkedFromIdentifier });
  };

  /**
   * Create a new agent with session.
   * Automatically normalizes market agent config (handles model as object).
   */
  createAgent = async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    const normalizedConfig = normalizeMarketAgentModel(params.config);

    return lambdaClient.agent.createAgent.mutate({
      config: normalizedConfig as any,
      groupId: params.groupId,
    });
  };

  /**
   * Create a virtual agent without session.
   * Used for Group Agent Builder to create virtual agents for groups.
   */
  createAgentOnly = async (params: CreateAgentOnlyParams): Promise<CreateAgentOnlyResult> => {
    const normalizedConfig = normalizeMarketAgentModel(params.config);

    return lambdaClient.agent.createAgentOnly.mutate({
      config: normalizedConfig as any,
      groupId: params.groupId,
    });
  };

  createAgentKnowledgeBase = async (
    agentId: string,
    knowledgeBaseId: string,
    enabled?: boolean,
  ) => {
    return lambdaClient.agent.createAgentKnowledgeBase.mutate({
      agentId,
      enabled,
      knowledgeBaseId,
    });
  };

  deleteAgentKnowledgeBase = async (agentId: string, knowledgeBaseId: string) => {
    return lambdaClient.agent.deleteAgentKnowledgeBase.mutate({ agentId, knowledgeBaseId });
  };

  toggleKnowledgeBase = async (agentId: string, knowledgeBaseId: string, enabled?: boolean) => {
    return lambdaClient.agent.toggleKnowledgeBase.mutate({
      agentId,
      enabled,
      knowledgeBaseId,
    });
  };

  createAgentFiles = async (agentId: string, fileIds: string[], enabled?: boolean) => {
    return lambdaClient.agent.createAgentFiles.mutate({ agentId, enabled, fileIds });
  };

  deleteAgentFile = async (agentId: string, fileId: string) => {
    return lambdaClient.agent.deleteAgentFile.mutate({ agentId, fileId });
  };

  toggleFile = async (agentId: string, fileId: string, enabled?: boolean) => {
    return lambdaClient.agent.toggleFile.mutate({
      agentId,
      enabled,
      fileId,
    });
  };

  getFilesAndKnowledgeBases = async (agentId: string) => {
    return lambdaClient.agent.getKnowledgeBasesAndFiles.query({ agentId });
  };

  getAgentConfigById = async (agentId: string) => {
    return lambdaClient.agent.getAgentConfigById.query({ agentId });
  };

  /**
   * @deprecated use getAgentConfigById instead
   */
  getSessionConfig = async (sessionId: string) => {
    return lambdaClient.agent.getAgentConfig.query({ sessionId });
  };

  /**
   * Update agent config and return the updated agent data
   */
  updateAgentConfig = async (
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
  ) => {
    return lambdaClient.agent.updateAgentConfig.mutate(
      { agentId, value: config },
      { context: { showNotification: false }, signal },
    );
  };

  /**
   * Update agent meta and return the updated agent data
   */
  updateAgentMeta = async (agentId: string, meta: Partial<MetaData>, signal?: AbortSignal) => {
    return lambdaClient.agent.updateAgentConfig.mutate({ agentId, value: meta }, { signal });
  };

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * This is a generic interface for all builtin agents (page-copilot, inbox, etc.)
   */
  getBuiltinAgent = async (slug: string) => {
    return lambdaClient.agent.getBuiltinAgent.query({ slug });
  };

  /**
   * Remove an agent and its associated session
   */
  removeAgent = async (agentId: string) => {
    return lambdaClient.agent.removeAgent.mutate({ agentId });
  };

  /**
   * Query non-virtual agents with optional keyword filter.
   * Returns agents with minimal info (id, title, description, avatar, backgroundColor).
   */
  queryAgents = async (params?: { keyword?: string; limit?: number; offset?: number }) => {
    return lambdaClient.agent.queryAgents.query(params);
  };

  /**
   * Pin or unpin an agent
   */
  updateAgentPinned = async (agentId: string, pinned: boolean) => {
    return lambdaClient.agent.updateAgentPinned.mutate({ id: agentId, pinned });
  };

  /**
   * Duplicate an agent.
   * Returns the new agent ID.
   */
  duplicateAgent = async (
    agentId: string,
    newTitle?: string,
  ): Promise<{ agentId: string } | null> => {
    return lambdaClient.agent.duplicateAgent.mutate({ agentId, newTitle });
  };
}

export const agentService = new AgentService();
