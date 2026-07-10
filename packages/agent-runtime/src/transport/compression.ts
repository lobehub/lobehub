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
}

export interface CompressionPromptInput {
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
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupFinalizeResult {
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
}
