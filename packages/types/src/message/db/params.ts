import { GroundingSearch } from '../../search';
import {
  ChatImageItem,
  ChatMessageError,
  ChatToolPayload,
  MessageMetadata,
  MessageToolCall,
  ModelReasoning,
} from '../common';
import { UIChatMessage } from '../ui';

export interface QueryMessageParams {
  current?: number;
  groupId?: string | null;
  pageSize?: number;
  sessionId?: string | null;
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
  role: 'user' | 'system' | 'assistant' | 'tool';
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
  provider?: string;
  reasoning?: ModelReasoning;
  role?: string;
  search?: GroundingSearch;
  toolCalls?: MessageToolCall[];
  tools?: ChatToolPayload[] | null;
}

export interface NewMessageQueryParams {
  embeddingsId: string;
  messageId: string;
  rewriteQuery: string;
  userQuery: string;
}
