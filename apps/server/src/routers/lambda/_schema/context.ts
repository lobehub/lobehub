import { z } from 'zod';

/**
 * Conversation context schema
 * Supports both agentId and sessionId for backward compatibility
 *
 * Priority: agentId > sessionId
 * When both are provided, agentId will be used to resolve the corresponding sessionId
 */
export const conversationContextSchema = z.object({
  agentId: z.string().optional(),
  groupId: z.string().nullish(),
  sessionId: z.string().nullish(),
  threadId: z.string().nullish(),
  topicId: z.string().nullish(),
});

/**
 * Simplified context
 * Used for CRUD operations of messages and topics
 */
export const basicContextSchema = z.object({
  agentId: z.string().optional(),
  groupId: z.string().nullish(),
  sessionId: z.string().nullish(),
  threadId: z.string().nullish(),
  topicId: z.string().nullish(),
});

export type ConversationContextInput = z.infer<typeof conversationContextSchema>;
export type BasicContextInput = z.infer<typeof basicContextSchema>;
