import { z } from 'zod';

import type { SessionGroupItem } from '@/database/schemas';

// ==================== Agent Group CRUD Types ====================
// Agent group (stored in sessionGroups table) related type definitions

/**
 * Create agent group request parameters
 */
export interface CreateAgentGroupRequest {
  name: string;
  sort?: number;
}

export const CreateAgentGroupRequestSchema = z.object({
  name: z.string().min(1, '助理分类名称不能为空'),
  sort: z.number().nullish(),
});

/**
 * Update agent group request parameters
 */
export interface UpdateAgentGroupRequest {
  id: string;
  name?: string;
  sort?: number;
}

export const UpdateAgentGroupRequestSchema = z.object({
  name: z.string().min(1, '助理分类名称不能为空').nullish(),
  sort: z.number().nullish(),
});

/**
 * Delete agent group request parameters
 */
export interface DeleteAgentGroupRequest {
  id: string;
}

// ==================== Agent Group Response Types ====================

/**
 * Agent group list response type
 */
export type AgentGroupListResponse = SessionGroupItem[];

// ==================== Common Schemas ====================

export const AgentGroupIdParamSchema = z.object({
  id: z.string().min(1, '助理分类 ID 不能为空'),
});
