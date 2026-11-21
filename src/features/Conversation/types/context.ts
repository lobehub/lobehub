import { type ConversationContext as BaseConversationContext } from '@lobechat/types';

/**
 * Extended Conversation Context
 *
 * Extends the base ConversationContext with optional metadata.
 * Used to locate messages in the session → topic → thread hierarchy.
 *
 * Design Principles:
 * - ❌ No `mode` field (avoid hardcoded types)
 * - ✅ Only data coordinates (sessionId/topicId/threadId)
 * - ✅ Scenario is naturally determined by coordinate combination
 */
export interface ConversationContext extends BaseConversationContext {
  /**
   * Metadata (optional, for extension)
   *
   * Can be used to store additional context-specific data:
   * - knowledgeBaseId: For knowledge base chat
   * - agentId: For agent preview chat
   * - preview: Boolean flag for preview mode
   * - etc.
   */
  metadata?: Record<string, any>;
}

/**
 * Helper type: Extract metadata type for better type safety
 */
export type ConversationMetadata<T = Record<string, any>> = T;

/**
 * Common metadata types
 */
export interface KnowledgeBaseMetadata {
  knowledgeBaseId: string;
}

export interface AgentPreviewMetadata {
  agentId: string;
  preview: true;
}
