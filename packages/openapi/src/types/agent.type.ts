import type { LobeAgentChatConfig } from '@lobechat/types';
import { z } from 'zod';

import type { AgentItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';

// ==================== Agent CRUD Types ====================

/**
 * Create Agent request parameters
 */
export interface CreateAgentRequest {
  avatar?: string;
  chatConfig?: LobeAgentChatConfig;
  description?: string;
  model?: string;
  params?: Record<string, unknown>;
  provider?: string;
  systemRole?: string;
  title: string;
}

export type GetAgentsRequest = IPaginationQuery;

export const CreateAgentRequestSchema = z.object({
  avatar: z.string().nullish(),
  chatConfig: z
    .object({
      autoCreateTopicThreshold: z.number(),
      disableContextCaching: z.boolean().nullish(),
      displayMode: z.enum(['chat', 'docs']).nullish(),
      enableAutoCreateTopic: z.boolean().nullish(),
      enableCompressHistory: z.boolean().nullish(),
      enableHistoryCount: z.boolean().nullish(),
      enableMaxTokens: z.boolean().nullish(),
      enableReasoning: z.boolean().nullish(),
      enableReasoningEffort: z.boolean().nullish(),
      historyCount: z.number().nullish(),
      reasoningBudgetToken: z.number().nullish(),
      reasoningEffort: z.enum(['low', 'medium', 'high']).nullish(),
      searchFCModel: z.string().nullish(),
      searchMode: z.enum(['disabled', 'enabled']).nullish(),
      useModelBuiltinSearch: z.boolean().nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  model: z.string().nullish(),
  params: z.record(z.unknown()).nullish(),
  provider: z.string().nullish(),
  systemRole: z.string().nullish(),
  title: z.string().min(1, '标题不能为空'),
});

/**
 * Update Agent request parameters
 */
export type UpdateAgentRequest = CreateAgentRequest & {
  id: string;
};

export const UpdateAgentRequestSchema = CreateAgentRequestSchema.partial();

/**
 * Delete Agent request parameters
 */
export interface AgentDeleteRequest {
  agentId: string;
  migrateSessionTo?: string;
}

export const AgentDeleteRequestSchema = z.object({
  agentId: z.string().min(1, 'Agent ID 不能为空'),
  migrateSessionTo: z.string().nullish(),
});

// ==================== Agent Batch Operations ====================

/**
 * Batch delete Agents request parameters
 */
export interface BatchDeleteAgentsRequest {
  agentIds: string[];
  migrateSessionTo?: string;
}

/**
 * Batch update Agents request parameters
 */
export interface BatchUpdateAgentsRequest {
  agentIds: string[];
  updateData: {
    avatar?: string;
    description?: string;
    model?: string;
    provider?: string;
    systemRole?: string;
  };
}

/**
 * Batch operation result type
 */
export interface BatchOperationResult {
  errors?: Array<{
    error: string;
    id: string;
  }>;
  failed: number;
  success: number;
  total: number;
}

// ==================== Agent Session Relations ====================

/**
 * Agent-Session link operation request parameters
 */
export interface AgentSessionLinkRequest {
  sessionId: string;
}

/**
 * Agent-Session batch link operation request parameters
 */
export interface AgentSessionBatchLinkRequest {
  sessionIds: string[];
}

/**
 * Create Session for Agent request parameters
 */
export interface CreateSessionForAgentRequest {
  agentId: string;
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  title?: string;
}

/**
 * Agent-Session relationship response type
 */
export interface AgentSessionRelation {
  agentId: string;
  session: {
    avatar: string | null;
    description: string | null;
    id: string;
    title: string | null;
    updatedAt: Date;
  };
  sessionId: string;
}

// ==================== Agent Response Types ====================

/**
 * Agent list response type
 */
export type AgentListResponse = PaginationQueryResponse<{
  agents: AgentItem[];
}>;

/**
 * Agent detail response type, includes complete configuration information
 */
export interface AgentDetailResponse extends AgentItem {
  agentsFiles?: Array<{
    file: {
      fileType: string;
      id: string;
      name: string;
      size: number;
    };
  }>;
  agentsKnowledgeBases?: Array<{
    knowledgeBase: {
      description: string | null;
      id: string;
      name: string;
    };
  }>;
  agentsToSessions?: Array<{
    session: {
      avatar: string | null;
      description: string | null;
      id: string;
      title: string | null;
      updatedAt: Date;
    };
  }>;
}

// ==================== Common Schemas ====================

export const AgentIdParamSchema = z.object({
  id: z.string().min(1, 'Agent ID 不能为空'),
});
