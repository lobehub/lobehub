import type { ChatTopicMetadata } from '@lobechat/types';
import { z } from 'zod';

import type { TopicItem, UserItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Topic Query Types ====================

export interface TopicListQuery extends IPaginationQuery {
  agentId?: string | null;
  excludeTriggers?: string[];
  groupId?: string | null;
  isInbox?: boolean;
}

export const TopicListQuerySchema = z
  .object({
    agentId: z.string().nullish(),
    excludeTriggers: z.array(z.string()).optional(),
    groupId: z.string().nullish(),
    isInbox: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .extend(PaginationQuerySchema.shape);

// ==================== Topic CRUD Types ====================

export interface TopicCreateRequest {
  agentId?: string | null;
  clientId?: string;
  favorite?: boolean;
  groupId?: string | null;
  title: string;
}

export const TopicCreateRequestSchema = z.object({
  agentId: z.string().nullish(),
  clientId: z.string().optional(),
  favorite: z.boolean().optional(),
  groupId: z.string().nullish(),
  title: z.string().min(1, '标题不能为空'),
});

export interface TopicUpdateRequest {
  favorite?: boolean;
  historySummary?: string;
  metadata?: ChatTopicMetadata;
  title?: string;
}

export const TopicUpdateRequestSchema = z.object({
  favorite: z.boolean().optional(),
  historySummary: z.string().optional(),
  metadata: z
    .object({
      model: z.string().optional(),
      provider: z.string().optional(),
      boundDeviceId: z.string().optional(),
      workingDirectory: z.string().optional(),
    })
    .optional(),
  title: z.string().min(1, '标题不能为空').optional(),
});

// ==================== Topic Response Types ====================

export interface TopicResponse extends TopicItem {
  messageCount: number;
  user: UserItem;
}

/**
 * Topic list response type
 */
export type TopicListResponse = PaginationQueryResponse<{
  topics: TopicResponse[];
}>;

// ==================== Common Schemas ====================

export const TopicGetParamSchema = z.object({
  id: z.string().min(1, '话题ID不能为空'),
});

export const TopicDeleteParamSchema = z.object({
  id: z.string().min(1, '话题ID不能为空'),
});

export const TopicUpdateParamSchema = z.object({
  id: z.string().min(1, '话题ID不能为空'),
});
