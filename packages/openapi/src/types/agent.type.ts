import type { LobeAgentAgencyConfig, LobeAgentChatConfig } from '@lobechat/types';
import { AgentPluginModeSchema } from '@lobechat/types';
import { AgentGraphSchema } from '@lobechat/types/agent/graph';
import { z } from 'zod';

import { KNOWLEDGE_BASE_VISIBILITY } from '@/database/schemas';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PublicAgent, PublicFile, PublicKnowledgeBase } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, jsonObjectSchema, PaginationQuerySchema } from './common.type';

// ==================== Agent CRUD Types ====================

/**
 * Create Agent request parameters
 */
export interface CreateAgentRequest {
  agencyConfig?: Pick<LobeAgentAgencyConfig, 'enableGraphMode' | 'graph'>;
  avatar?: string;
  chatConfig?: LobeAgentChatConfig;
  description?: string;
  model?: string;
  params?: Record<string, unknown>;
  personal?: boolean;
  plugins?: Array<{ identifier: string; mode?: 'pinned' | 'auto' | 'disabled' }>;
  provider?: string;
  systemRole?: string;
  title: string;
}

export type GetAgentsRequest = IPaginationQuery & { personal?: boolean };

export const GetAgentsQuerySchema = PaginationQuerySchema.extend({
  personal: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const CreateAgentRequestSchema = z.object({
  agencyConfig: z
    .object({
      enableGraphMode: z.boolean().nullish(),
      graph: AgentGraphSchema.nullish(),
    })
    .nullish(),
  avatar: z.string().nullish(),
  chatConfig: z
    .object({
      disableContextCaching: z.boolean().nullish(),
      displayMode: z.enum(['chat', 'docs']).nullish(),
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
  plugins: z
    .array(
      z
        .object({
          identifier: z.string().min(1).max(255),
          mode: z.enum(['pinned', 'auto', 'disabled']).optional(),
        })
        .strict(),
    )
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.identifier)).size === items.length,
      'Duplicate plugin identifiers',
    )
    .optional(),
  params: z.record(z.string(), z.unknown()).nullish(),
  personal: z.boolean().optional(),
  provider: z.string().nullish(),
  systemRole: z.string().nullish(),
  title: z.string().min(1, 'Title cannot be empty'),
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
  agentId: z.string().min(1, 'Agent ID cannot be empty'),
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
  agents: PublicAgent[];
}>;

/**
 * Agent detail response type, includes complete configuration information
 */
export interface AgentDetailResponse extends PublicAgent {
  files?: Array<PublicFile & { enabled?: boolean | null }>;
  knowledgeBases?: Array<PublicKnowledgeBase & { enabled?: boolean | null }>;
}

// ==================== Common Schemas ====================

export const AgentIdParamSchema = z.object({
  id: z.string().min(1, 'Agent ID cannot be empty'),
});

export const DuplicateAgentSchema = z
  .object({ title: z.string().trim().min(1).max(255).optional() })
  .strict();

// ==================== Response Schemas ====================

/** One `plugins[]` entry as `parsePluginEntry` normalizes it: legacy strings become `pinned`. */
const AgentPluginSchema = z
  .object({ identifier: z.string(), mode: AgentPluginModeSchema })
  .strict()
  .meta({ id: 'AgentPlugin' });

/**
 * `projectPublicAgent` output. Tied to `PublicAgent` so a field added to the
 * projection fails type-checking here instead of silently leaving the spec.
 */
const agentShape = {
  /** Stored graph/permission settings; keys are written by several features. */
  agencyConfig: jsonObjectSchema.nullable(),
  avatar: z.string().nullable(),
  /** Stored `LobeAgentChatConfig`; the product adds keys over time. */
  chatConfig: jsonObjectSchema.nullable(),
  createdAt: dateTimeSchema,
  description: z.string().nullable(),
  id: z.string(),
  model: z.string().nullable(),
  /** Stored model parameters (temperature, top_p, …), owned by the client. */
  params: jsonObjectSchema.nullable(),
  personal: z.boolean(),
  plugins: z.array(AgentPluginSchema),
  provider: z.string().nullable(),
  slug: z.string().nullable(),
  systemRole: z.string().nullable(),
  title: z.string().nullable(),
  updatedAt: dateTimeSchema,
} satisfies Record<keyof PublicAgent, z.ZodType>;

export const AgentSchema = z.object(agentShape).strict().meta({ id: 'Agent' });

/** A file mounted on an agent: `projectPublicFile` plus the mount's `enabled` flag. */
export const AgentFileSchema = z
  .object({
    createdAt: dateTimeSchema,
    enabled: z.boolean().nullable(),
    fileType: z.string(),
    id: z.string(),
    metadata: jsonObjectSchema.nullable(),
    name: z.string(),
    parentId: z.string().nullable(),
    size: z.number().int(),
    source: z.string().nullable(),
    updatedAt: dateTimeSchema,
    url: z.string(),
    visibility: z.enum(['private', 'public']),
  } satisfies Record<keyof PublicFile | 'enabled', z.ZodType>)
  .strict()
  .meta({ id: 'AgentFile' });

/** A knowledge base mounted on an agent: `projectPublicKnowledgeBase` plus `enabled`. */
export const AgentKnowledgeBaseSchema = z
  .object({
    avatar: z.string().nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    enabled: z.boolean().nullable(),
    id: z.string(),
    isPublic: z.boolean().nullable(),
    name: z.string(),
    settings: jsonObjectSchema.nullable(),
    type: z.string().nullable(),
    updatedAt: dateTimeSchema,
    visibility: z.enum(KNOWLEDGE_BASE_VISIBILITY),
  } satisfies Record<keyof PublicKnowledgeBase | 'enabled', z.ZodType>)
  .strict()
  .meta({ id: 'AgentKnowledgeBase' });

/** `GET /agents/:id` and `POST /agents/:id/duplicate`: the agent plus its mounted knowledge. */
export const AgentDetailSchema = AgentSchema.extend({
  files: z.array(AgentFileSchema),
  knowledgeBases: z.array(AgentKnowledgeBaseSchema),
})
  .strict()
  .meta({ id: 'AgentDetail' });

export const AgentListSchema = z
  .object({ ...pageInfoShape, agents: z.array(AgentSchema), ...totalShape })
  .strict()
  .meta({ id: 'AgentList' });
