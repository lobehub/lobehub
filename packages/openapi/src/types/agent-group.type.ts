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
  name: z.string().min(1, 'Agent category name cannot be empty'),
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
  name: z.string().min(1, 'Agent category name cannot be empty').nullish(),
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
  id: z.string().min(1, 'Agent category ID cannot be empty'),
});
