import type { DBMessageItem, FileItem } from '@lobechat/types';
import { z } from 'zod';

import type { SessionItem, TopicItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Message Query Types ====================

export interface MessagesQueryByTopicRequest {
  topicId: string;
}

export const MessagesQueryByTopicRequestSchema = z.object({
  topicId: z.string().min(1, 'Topic ID cannot be empty'),
});

/**
 * Message count statistics query parameters
 */
export interface MessagesCountQuery {
  topicIds?: string[];
  userId?: string;
}

export const MessagesCountQuerySchema = z.object({
  // Count by topic ID array (comma-separated string, e.g., "topic1,topic2,topic3")
  topicIds: z.string().nullish(),
  // Count by user ID (admin only)
  userId: z.string().nullish(),
});

export interface CountByTopicsRequest {
  topicIds: string[];
}

export const CountByTopicsRequestSchema = z.object({
  topicIds: z.array(z.string()).min(1, 'Topic ID array cannot be empty'),
});

export interface CountByUserRequest {
  userId: string;
}

export const CountByUserRequestSchema = z.object({
  userId: z.string().min(1, 'User ID cannot be empty'),
});

// ==================== Message List Query Types ====================

/**
 * Message list query parameters
 */
export interface MessagesListQuery extends IPaginationQuery {
  role?: 'user' | 'system' | 'assistant' | 'tool';
  topicId?: string;
  userId?: string;
}

export const MessagesListQuerySchema = z
  .object({
    // Filter parameters
    topicId: z.string().nullish(),
    userId: z.string().nullish(),
    role: z.enum(['user', 'system', 'assistant', 'tool']).nullish(),
  })
  .extend(PaginationQuerySchema.shape)
  .refine((data) => Boolean(data.topicId || data.userId), {
    message: 'At least one filter parameter must be provided: topicId or userId',
  });

// ==================== Message Search Types ====================

export interface SearchMessagesByKeywordRequest {
  keyword: string;
  limit?: number;
  offset?: number;
}

export const SearchMessagesByKeywordRequestSchema = z.object({
  keyword: z.string().min(1, 'Search keyword cannot be empty'),
  limit: z.number().min(1).max(100).nullish().default(20),
  offset: z.number().min(0).nullish().default(0),
});

// ==================== Message CRUD Types ====================

export interface MessagesCreateRequest {
  agentId?: string | null;
  // Client identifier
  clientId?: string;

  content: string;
  // Status
  favorite?: boolean;

  // File association
  files?: string[];
  // Extended data
  metadata?: any;
  // AI-related fields
  model?: string;

  observationId?: string | null;
  // Message association
  parentId?: string | null;
  provider?: string;

  quotaId?: string | null;

  reasoning?: any;
  role: 'user' | 'system' | 'assistant' | 'tool';
  search?: any;
  threadId?: string | null;
  tools?: any;

  topicId: string | null;

  // Tracking identifier
  traceId?: string | null;
}

export const MessagesCreateRequestSchema = z.object({
  content: z.string().min(1, 'Message content cannot be empty'),
  role: z.enum(['user', 'system', 'assistant', 'tool'], { required_error: 'Invalid role type' }),

  // AI-related fields
  model: z.string().nullish(), // Model used
  provider: z.string().nullish(), // Provider

  topicId: z.string().nullable().nullish(),
  threadId: z.string().nullable().nullish(),

  // Message association
  parentId: z.string().nullable().nullish(), // Parent message ID
  quotaId: z.string().nullable().nullish(), // Quoted message ID
  agentId: z.string().nullable().nullish(), // Associated Agent ID

  // Client identifier
  clientId: z.string().nullish(), // Client ID, used for cross-device sync

  // Extended data
  metadata: z.any().nullish(), // Metadata
  reasoning: z.any().nullish(), // Reasoning process
  search: z.any().nullish(), // Search results
  tools: z.any().nullish(), // Tool calls

  // Tracking identifier
  traceId: z.string().nullable().nullish(), // Trace ID
  observationId: z.string().nullable().nullish(), // Observation ID

  // File association
  files: z.array(z.string()).nullish(), // File ID array

  // Status
  favorite: z.boolean().nullish().default(false), // Whether favorited
});

export const MessagesCreateWithReplyRequestSchema = MessagesCreateRequestSchema.extend({
  role: z.literal('user', { errorMap: () => ({ message: 'Role must be user when creating an AI reply' }) }),
});

export type MessagesCreateWithReplyRequest = z.infer<typeof MessagesCreateWithReplyRequestSchema>;

export interface MessagesUpdateRequest {
  content?: string;
  error?: any;
  favorite?: boolean;
  metadata?: any;
  reasoning?: any;
  search?: any;
  tools?: any;
}

export const MessagesUpdateRequestSchema = z.object({
  content: z.string().min(1, 'Message content cannot be empty').nullish(),
  favorite: z.boolean().nullish(),
  metadata: z.any().nullish(),
  reasoning: z.any().nullish(),
  search: z.any().nullish(),
  tools: z.any().nullish(),
  error: z.any().nullish(),
});

// ==================== Message Batch Operations ====================

export interface MessagesDeleteBatchRequest {
  messageIds: string[];
}

export const MessagesDeleteBatchRequestSchema = z.object({
  messageIds: z.array(z.string().min(1, 'Message ID cannot be empty')).min(1, 'Message ID array cannot be empty'),
});

// ==================== Message Response Types ====================

export interface MessageIdParam {
  id: string;
}

// Message type queried from database join, includes associated session and topic info
export interface MessageResponseFromDatabase extends DBMessageItem {
  filesToMessages: { file: FileItem; messageId: string }[] | null;
  session: SessionItem | null;
  topic: TopicItem | null;
}

// Return type for message query, includes associated session and topic info
export interface MessageResponse extends Omit<MessageResponseFromDatabase, 'filesToMessages'> {
  files: FileItem[] | null;
}

export type MessageListResponse = PaginationQueryResponse<{
  messages: MessageResponse[];
}>;

// ==================== Common Schemas ====================

export const MessageIdParamSchema = z.object({
  id: z.string().min(1, 'Message ID cannot be empty'),
});
