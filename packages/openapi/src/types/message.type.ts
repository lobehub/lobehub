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
  topicId: z.string().min(1, '话题ID不能为空'),
});

/**
 * 消息数量统计查询参数
 */
export interface MessagesCountQuery {
  topicIds?: string[];
  userId?: string;
}

export const MessagesCountQuerySchema = z.object({
  // 按话题ID数组统计 (comma-separated string, e.g., "topic1,topic2,topic3")
  topicIds: z.string().nullish(),
  // 按用户ID统计 (仅管理员)
  userId: z.string().nullish(),
});

export interface CountByTopicsRequest {
  topicIds: string[];
}

export const CountByTopicsRequestSchema = z.object({
  topicIds: z.array(z.string()).min(1, '话题ID数组不能为空'),
});

export interface CountByUserRequest {
  userId: string;
}

export const CountByUserRequestSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
});

// ==================== Message List Query Types ====================

/**
 * 消息列表查询参数
 */
export interface MessagesListQuery extends IPaginationQuery {
  role?: 'user' | 'system' | 'assistant' | 'tool';
  topicId?: string;
  userId?: string;
}

export const MessagesListQuerySchema = z
  .object({
    // 过滤参数
    topicId: z.string().nullish(),
    userId: z.string().nullish(),
    role: z.enum(['user', 'system', 'assistant', 'tool']).nullish(),
  })
  .extend(PaginationQuerySchema.shape)
  .refine((data) => Boolean(data.topicId || data.userId), {
    message: '至少需要提供一个过滤参数：topicId 或 userId',
  });

// ==================== Message Search Types ====================

export interface SearchMessagesByKeywordRequest {
  keyword: string;
  limit?: number;
  offset?: number;
}

export const SearchMessagesByKeywordRequestSchema = z.object({
  keyword: z.string().min(1, '搜索关键词不能为空'),
  limit: z.number().min(1).max(100).nullish().default(20),
  offset: z.number().min(0).nullish().default(0),
});

// ==================== Message CRUD Types ====================

export interface MessagesCreateRequest {
  agentId?: string | null;
  // 客户端标识
  clientId?: string;

  content: string;
  // 状态
  favorite?: boolean;

  // 文件关联
  files?: string[];
  // 扩展数据
  metadata?: any;
  // AI相关字段
  model?: string;

  observationId?: string | null;
  // 消息关联
  parentId?: string | null;
  provider?: string;

  quotaId?: string | null;

  reasoning?: any;
  role: 'user' | 'system' | 'assistant' | 'tool';
  search?: any;
  threadId?: string | null;
  tools?: any;

  topicId: string | null;

  // 追踪标识
  traceId?: string | null;
}

export const MessagesCreateRequestSchema = z.object({
  content: z.string().min(1, '消息内容不能为空'),
  role: z.enum(['user', 'system', 'assistant', 'tool'], { required_error: '角色类型无效' }),

  // AI相关字段
  model: z.string().nullish(), // 使用的模型
  provider: z.string().nullish(), // 提供商

  topicId: z.string().nullable().nullish(),
  threadId: z.string().nullable().nullish(),

  // 消息关联
  parentId: z.string().nullable().nullish(), // 父消息ID
  quotaId: z.string().nullable().nullish(), // 引用消息ID
  agentId: z.string().nullable().nullish(), // 关联的Agent ID

  // 客户端标识
  clientId: z.string().nullish(), // 客户端ID，用于跨设备同步

  // 扩展数据
  metadata: z.any().nullish(), // 元数据
  reasoning: z.any().nullish(), // 推理过程
  search: z.any().nullish(), // 搜索结果
  tools: z.any().nullish(), // 工具调用

  // 追踪标识
  traceId: z.string().nullable().nullish(), // 追踪ID
  observationId: z.string().nullable().nullish(), // 观测ID

  // 文件关联
  files: z.array(z.string()).nullish(), // 文件ID数组

  // 状态
  favorite: z.boolean().nullish().default(false), // 是否收藏
});

export const MessagesCreateWithReplyRequestSchema = MessagesCreateRequestSchema.extend({
  role: z.literal('user', { errorMap: () => ({ message: '创建 AI 回复时 role 必须为 user' }) }),
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
  content: z.string().min(1, '消息内容不能为空').nullish(),
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
  messageIds: z.array(z.string().min(1, '消息ID不能为空')).min(1, '消息ID数组不能为空'),
});

// ==================== Message Response Types ====================

export interface MessageIdParam {
  id: string;
}

// 从数据库联表查询出来的消息类型，包含关联的 session 和 topic 信息
export interface MessageResponseFromDatabase extends DBMessageItem {
  filesToMessages: { file: FileItem; messageId: string }[] | null;
  session: SessionItem | null;
  topic: TopicItem | null;
}

// 消息查询时的返回类型，包含关联的 session 和 topic 信息
export interface MessageResponse extends Omit<MessageResponseFromDatabase, 'filesToMessages'> {
  files: FileItem[] | null;
}

export type MessageListResponse = PaginationQueryResponse<{
  messages: MessageResponse[];
}>;

// ==================== Common Schemas ====================

export const MessageIdParamSchema = z.object({
  id: z.string().min(1, '消息ID不能为空'),
});
