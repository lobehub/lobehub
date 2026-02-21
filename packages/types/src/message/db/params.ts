/* eslint-disable sort-keys-fix/sort-keys-fix */
import { z } from 'zod';

import type { GroundingSearch } from '../../search';
import { GroundingSearchSchema } from '../../search';
import type {
  ChatImageItem,
  ChatMessageError,
  ChatToolPayload,
  MessageMetadata,
  MessageToolCall,
  ModelReasoning,
} from '../common';
import {
  ChatImageItemSchema,
  ChatMessageErrorSchema,
  ChatToolPayloadSchema,
  MessageMetadataSchema,
  MessageToolCallSchema,
  ModelReasoningSchema,
} from '../common';
import type { UIChatMessage } from '../ui';

export interface QueryMessageParams {
  agentId?: string | null;
  current?: number;
  groupId?: string | null;
  pageSize?: number;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}

/**
 * Result type for createNewMessage
 * Contains both the created message ID and the full message list with grouping applied
 */
export interface CreateMessageResult {
  /**
   * The ID of the created message
   */
  id: string;

  /**
   * Complete message list with groupAssistantMessages transformation applied
   * This includes the newly created message and all existing messages in the session/topic
   */
  messages: UIChatMessage[];
}

/**
 * Result type for updateMessage
 * Contains success status and optional message list
 */
export interface UpdateMessageResult {
  /**
   * Updated message list (only present when success is true and sessionId/topicId provided)
   */
  messages?: UIChatMessage[];
  /**
   * Whether the update was successful
   */
  success: boolean;
}

export interface NewMessage {
  agentId?: string | null;
  clientId?: string | null;
  content?: string | null;
  createdAt?: Date;
  // optional because it has a default value
  error?: any | null;
  favorite?: boolean;
  id?: string;
  model?: string | null;
  observationId?: string | null;
  parentId?: string | null;
  provider?: string | null;
  quotaId?: string | null;
  // optional because it has a default function
  role: 'user' | 'system' | 'assistant' | 'tool' | 'task';
  // required because it's notNull
  sessionId?: string | null;
  threadId?: string | null;
  tools?: any | null;
  topicId?: string | null;
  traceId?: string | null;
  // optional because it's generated
  updatedAt?: Date;
  userId: string; // optional because it's generated
}

export interface UpdateMessageParams {
  content?: string;
  error?: ChatMessageError | null;
  imageList?: ChatImageItem[];
  metadata?: MessageMetadata;
  model?: string;
  observationId?: string;
  provider?: string;
  reasoning?: ModelReasoning;
  role?: string;
  search?: GroundingSearch;
  toolCalls?: MessageToolCall[];
  tools?: ChatToolPayload[] | null;
  traceId?: string;
}

export interface NewMessageQueryParams {
  embeddingsId: string;
  messageId: string;
  rewriteQuery: string;
  userQuery: string;
}

// ========== Zod Schemas ========== //

export const UpdateMessageParamsSchema = z
  .object({
    content: z.string().optional(),
    error: ChatMessageErrorSchema.nullable().optional(),
    imageList: z.array(ChatImageItemSchema).optional(),
    metadata: MessageMetadataSchema.optional(),
    model: z.string().optional(),
    observationId: z.string().optional(),
    provider: z.string().optional(),
    reasoning: ModelReasoningSchema.optional(),
    role: z.string().optional(),
    search: GroundingSearchSchema.optional(),
    toolCalls: z.array(MessageToolCallSchema).optional(),
    tools: z.array(ChatToolPayloadSchema).nullable().optional(),
    traceId: z.string().optional(),
  })
  .passthrough();
