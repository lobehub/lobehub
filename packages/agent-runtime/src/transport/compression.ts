import type { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

export interface CompressionGroupCreateInput {
  agentId?: string;
  groupId?: string;
  messageIds: string[];
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupCreateResult {
  messageGroupId: string;
  messages?: UIChatMessage[];
  messagesToSummarize: UIChatMessage[];
  signal?: AbortSignal;
}

export interface CompressionPromptInput {
  /**
   * The conversation as the context engine builds it for the model
   * (`ContextBuilder.build` output). When present, transports summarize this
   * instead of `messages`: the engine has already trimmed stale tool output
   * and truncated history, so it is what the model actually works with and
   * stays within the window the compression budget was checked against.
   */
  conversation?: unknown[];
  existingSummary?: string;
  messages: UIChatMessage[];
}

export interface CompressionPromptResult {
  messages: OpenAIChatMessage[];
}

export interface CompressionGroupFinalizeInput {
  agentId?: string;
  content: string;
  groupId?: string;
  messageGroupId: string;
  sourceGroupIds?: string[];
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupFinalizeResult {
  messages?: UIChatMessage[];
}

export interface CompressionGroupUpdateInput {
  content: string;
  messageGroupId: string;
}

export interface CompressionGroupRollbackInput {
  agentId?: string;
  error: unknown;
  groupId?: string;
  messageGroupId: string;
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupRollbackResult {
  messages?: UIChatMessage[];
}

/**
 * Persistence + prompt-preparation port for context compression.
 *
 * Compression is not just an LLM call: it creates a visible compressed-message
 * group, summarizes the grouped messages, then finalizes the group content.
 * Keeping those steps behind this transport lets package executors stay free of
 * database services and prompt-package dependencies.
 */
export interface CompressionTransport {
  buildPrompt: (input: CompressionPromptInput) => Promise<CompressionPromptResult>;
  createGroup: (input: CompressionGroupCreateInput) => Promise<CompressionGroupCreateResult>;
  finalizeGroup: (input: CompressionGroupFinalizeInput) => Promise<CompressionGroupFinalizeResult>;
  rollbackGroup?: (input: CompressionGroupRollbackInput) => Promise<CompressionGroupRollbackResult>;
  updateGroup?: (input: CompressionGroupUpdateInput) => void;
}
