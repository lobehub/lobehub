import { z } from 'zod';

/**
 * 会话上下文 Schema
 * 同时支持 agentId 和 sessionId，用于向后兼容
 *
 * 优先级：agentId > sessionId
 * 当同时提供时，agentId 会被用于解析对应的 sessionId
 */
export const conversationContextSchema = z.object({
  agentId: z.string().optional(),
  groupId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
});

/**
 * 简化版上下文
 * 用于 message 和 topic 的 CRUD 操作
 */
export const basicContextSchema = z.object({
  agentId: z.string().optional(),
  groupId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
});

export type ConversationContextInput = z.infer<typeof conversationContextSchema>;
export type BasicContextInput = z.infer<typeof basicContextSchema>;
