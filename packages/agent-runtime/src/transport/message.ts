import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';

/** Minimal reference an executor needs back after creating a message. */
export interface RuntimeMessageRef {
  id: string;
}

export interface QueryMessagesInput {
  agentId?: string;
  current?: number;
  groupId?: string;
  pageSize?: number;
  sessionId?: string;
  threadId?: string;
  topicId?: string;
}

export interface UpdateToolMessageInput {
  content?: string;
  metadata?: Record<string, any>;
  pluginError?: unknown;
  pluginState?: Record<string, any>;
}

/**
 * Persists and reads conversation messages for the runtime.
 *
 * The runtime never touches a database directly — it goes through this port.
 * Server adapter wraps `MessageModel` (DB); the client adapter wraps the
 * optimistic chat store. Methods are async and MUST NOT assume a transaction:
 * the client persists optimistically (in-memory first, DB later), the server
 * writes through.
 *
 * Reads return the shared {@link UIChatMessage} shape; creates return only the
 * id the caller needs to anchor follow-up writes.
 */
export interface MessageTransport {
  createAssistantMessage: (params: CreateMessageParams) => Promise<RuntimeMessageRef>;
  createToolMessage: (params: CreateMessageParams) => Promise<RuntimeMessageRef>;
  deleteMessage: (id: string) => Promise<void>;
  /** Existence / parent preflight; returns the id when present. */
  findById: (id: string) => Promise<RuntimeMessageRef | undefined>;
  query: (params?: QueryMessagesInput) => Promise<UIChatMessage[]>;
  update: (id: string, params: Partial<UpdateMessageParams>) => Promise<void>;
  updatePluginState: (id: string, state: Record<string, any>) => Promise<void>;
  updateToolMessage: (id: string, params: UpdateToolMessageInput) => Promise<void>;
}
