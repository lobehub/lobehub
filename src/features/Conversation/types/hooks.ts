import {
  type ChatToolPayload,
  type MessageToolCall,
  type SendMessageParams,
  type UIChatMessage,
} from '@lobechat/types';

/**
 * Conversation Lifecycle Hooks
 *
 * Allows external injection of custom behavior at various points
 * in the conversation lifecycle.
 *
 * All hooks are optional and can be used to:
 * - Validate or modify behavior before actions
 * - React to state changes
 * - Add analytics/logging
 * - Implement custom approval flows
 */
/* eslint-disable typescript-sort-keys/interface */
export interface ConversationHooks {
  // ========================================
  // Message Lifecycle Hooks
  // ========================================

  /**
   * Allow custom hooks to be added dynamically
   */
  [key: string]: ((...args: any[]) => any) | undefined;

  /**
   * Called after user and assistant messages are created in sendMessage.
   * This hook allows for custom post-message-creation behavior like:
   * - Refreshing thread lists
   * - Summarizing thread/topic titles
   * - Updating portal state
   *
   * @param params - Information about the created messages
   *
   * @example
   * ```ts
   * onAfterMessageCreate: async ({ createdThreadId, assistantMessageId }) => {
   *   if (createdThreadId) {
   *     // Refresh thread list for new thread
   *     await chatStore.refreshThreads();
   *     // Open thread in portal
   *     chatStore.openThreadInPortal(createdThreadId, sourceMessageId);
   *   }
   * }
   * ```
   */
  onAfterMessageCreate?: (params: {
    /** The created assistant message ID */
    assistantMessageId: string;
    /** The created thread ID (if a new thread was created) */
    createdThreadId?: string;
    /** The created user message ID */
    userMessageId: string;
  }) => Promise<void>;

  /**
   * Called after a message is successfully sent
   *
   * @example
   * ```ts
   * onAfterSendMessage: async () => {
   *   analytics.track('message_sent');
   * }
   * ```
   */
  onAfterSendMessage?: () => Promise<void>;

  /**
   * Called before continuing generation
   *
   * @param messageId - The message to continue from
   * @returns false to prevent continuation, true/void to continue
   */
  onBeforeContinue?: (messageId: string) => Promise<boolean | void>;

  /**
   * Called before regenerating a message
   *
   * @param messageId - The message to regenerate
   * @returns false to prevent regeneration, true/void to continue
   */
  onBeforeRegenerate?: (messageId: string) => Promise<boolean | void>;

  /**
   * Called before sending a message
   *
   * @param params - The message parameters
   * @returns false to prevent sending, true/void to continue
   *
   * @example
   * ```ts
   * onBeforeSendMessage: async (params) => {
   *   // Check for Chinese text with Gemini model
   *   if (await checkGeminiChineseWarning(params.message)) {
   *     return false; // Block sending
   *   }
   * }
   * ```
   */
  onBeforeSendMessage?: (params: SendMessageParams) => Promise<boolean | void>;

  /**
   * Called after continue generation completes
   *
   * @param messageId - The message ID
   */
  onContinueComplete?: (messageId: string) => void;

  // ========================================
  // Generation State Change Hooks
  // ========================================

  /**
   * Called when AI generation is cancelled
   *
   * @param operationId - The operation ID for this generation
   */
  onGenerationCancelled?: (operationId: string) => void;

  /**
   * Called when AI generation completes successfully
   *
   * @param operationId - The operation ID for this generation
   */
  onGenerationComplete?: (operationId: string) => void;

  /**
   * Called when AI generation starts
   *
   * @param operationId - The operation ID for this generation
   */
  onGenerationStart?: (operationId: string) => void;

  /**
   * Called when generation is stopped by user
   */
  onGenerationStop?: () => void;

  /**
   * Called when a message is copied
   *
   * @param messageId - The copied message ID
   */
  onMessageCopied?: (messageId: string) => void;

  /**
   * Called when a message is created (user or assistant)
   *
   * @param message - The created message
   */
  onMessageCreated?: (message: UIChatMessage) => void;

  /**
   * Called when a message is deleted
   *
   * @param messageId - The deleted message ID
   */
  onMessageDeleted?: (messageId: string) => void;

  /**
   * Called when a message error occurs
   *
   * @param error - The error that occurred
   * @param messageId - The message ID (if available)
   */
  onMessageError?: (error: Error, messageId?: string) => void;

  /**
   * Called when a message is modified
   *
   * @param messageId - The modified message ID
   * @param newContent - The new content
   * @param originalContent - The original content
   */
  onMessageModified?: (messageId: string, newContent: string, originalContent?: string) => void;

  // ========================================
  // Tool Interaction Hooks
  // ========================================

  /**
   * Called when an operation is cancelled
   *
   * @param operationId - The cancelled operation ID
   */
  onOperationCancelled?: (operationId: string) => void;

  /**
   * Called after regeneration completes
   *
   * @param messageId - The regenerated message ID
   */
  onRegenerateComplete?: (messageId: string) => void;

  /**
   * Called when a new thread is created
   *
   * @param threadId - The created thread ID
   */
  onThreadCreated?: (threadId: string) => void;

  /**
   * Called when a tool requires user approval
   *
   * @param toolCall - The tool call requiring approval
   * @returns true to approve, false to reject
   *
   * @example
   * ```ts
   * onToolApprovalRequired: async (toolCall) => {
   *   return await showCustomApprovalDialog(toolCall);
   * }
   * ```
   */
  onToolApprovalRequired?: (toolCall: MessageToolCall | ChatToolPayload) => Promise<boolean>;

  /**
   * Called when a tool is approved
   *
   * @param toolCallId - The approved tool call ID
   * @returns false to prevent approval, true/void to continue
   */
  onToolApproved?: (toolCallId: string) => Promise<boolean | void>;

  /**
   * Called when a tool call completes
   *
   * @param toolCallId - The tool call ID
   * @param result - The tool call result
   */
  onToolCallComplete?: (toolCallId: string, result: any) => void;

  // ========================================
  // Topic/Thread Change Hooks
  // ========================================

  /**
   * Called when a tool call encounters an error
   *
   * @param toolCallId - The tool call ID
   * @param error - The error that occurred
   */
  onToolCallError?: (toolCallId: string, error: Error) => void;

  /**
   * Called when a tool call starts
   *
   * @param toolCallId - The tool call ID
   */
  onToolCallStart?: (toolCallId: string) => void;

  /**
   * Called when a tool is rejected
   *
   * @param toolCallId - The rejected tool call ID
   * @param reason - The rejection reason
   * @returns false to prevent rejection, true/void to continue
   */
  onToolRejected?: (toolCallId: string, reason?: string) => Promise<boolean | void>;

  // ========================================
  // Custom Extension
  // ========================================

  /**
   * Called when a new topic is created
   *
   * @param topicId - The created topic ID
   */
  onTopicCreated?: (topicId: string) => void;
}
