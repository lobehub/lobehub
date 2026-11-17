import type { ChatTopicMetadata } from '@lobechat/types';
import { z } from 'zod';

import { THREAD_STATUS, THREAD_TYPE, topics } from '@/database/schemas/topic';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PublicTopic, PublicUser } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, jsonObjectSchema, PaginationQuerySchema } from './common.type';

// ==================== Topic Query Types ====================

export interface TopicListQuery extends IPaginationQuery {
  agentId?: string | null;
  excludeTriggers?: string[];
  groupId?: string | null;
  includeTriggers?: string[];
  isInbox?: boolean;
}

export const TopicListQuerySchema = z
  .object({
    agentId: z.string().nullish(),
    excludeTriggers: z.array(z.string()).optional(),
    groupId: z.string().nullish(),
    includeTriggers: z.array(z.string()).optional(),
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
  title: z.string().min(1, 'Title cannot be empty'),
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
  title: z.string().min(1, 'Title cannot be empty').optional(),
});

// ==================== Topic Response Types ====================

export interface TopicResponse extends PublicTopic {
  messageCount: number;
  user: PublicUser;
}

/**
 * Topic list response type
 */
export type TopicListResponse = PaginationQueryResponse<{
  topics: TopicResponse[];
}>;

// ==================== Common Schemas ====================

export const TopicGetParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

export const TopicDeleteParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

export const TopicUpdateParamSchema = z.object({
  id: z.string().min(1, 'Topic ID cannot be empty'),
});

// ==================== Response Schemas ====================

type ShapeOf<T> = Record<keyof T, z.ZodType>;

/** The owner of a topic, projected through `PUBLIC_USER_FIELDS`. */
const TopicOwnerSchema = z
  .object({
    avatar: z.string().nullable(),
    createdAt: dateTimeSchema,
    email: z.string().nullable(),
    firstName: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    isOnboarded: z.boolean().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    updatedAt: dateTimeSchema,
    username: z.string().nullable(),
  } satisfies ShapeOf<PublicUser>)
  .strict();

/** A topic row projected through `PUBLIC_TOPIC_FIELDS` — what a message embeds. */
export const TopicSummarySchema = z
  .object({
    agentId: z.string().nullable(),
    completedAt: dateTimeSchema.nullable(),
    content: z.string().nullable(),
    cost: jsonObjectSchema.nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    favorite: z.boolean().nullable(),
    groupId: z.string().nullable(),
    historySummary: z.string().nullable(),
    id: z.string(),
    metadata: jsonObjectSchema.nullable(),
    mode: z.string().nullable(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    sessionId: z.string().nullable(),
    status: z.enum(topics.status.enumValues).nullable(),
    title: z.string().nullable(),
    totalCost: z.number().nullable(),
    totalInputTokens: z.number().int().nullable(),
    totalOutputTokens: z.number().int().nullable(),
    totalTokens: z.number().int().nullable(),
    trigger: z.string().nullable(),
    updatedAt: dateTimeSchema,
    usage: jsonObjectSchema.nullable(),
  } satisfies ShapeOf<PublicTopic>)
  .strict()
  .meta({ id: 'TopicSummary' });

export const TopicSchema = TopicSummarySchema.extend({
  /** Messages stored in the topic. */
  messageCount: z.number().int().min(0),
  user: TopicOwnerSchema,
})
  .strict()
  .meta({ id: 'Topic' });

export const TopicListSchema = z
  .object({ ...pageInfoShape, topics: z.array(TopicSchema), ...totalShape })
  .strict();

export const TopicThreadSchema = z
  .object({
    createdAt: dateTimeSchema,
    id: z.string(),
    parentThreadId: z.string().nullable(),
    status: z.enum(THREAD_STATUS).nullable(),
    title: z.string().nullable(),
    topicId: z.string(),
    type: z.enum(THREAD_TYPE),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'TopicThread' });

export const TopicThreadListSchema = z
  .object({ ...pageInfoShape, threads: z.array(TopicThreadSchema), ...totalShape })
  .strict();
