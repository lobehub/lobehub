import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';

/** Minimal reference an executor needs back after creating a message. */
export interface RuntimeMessageRef {
  agentId?: string | null;
  groupId?: string | null;
  id: string;
  model?: string | null;
  parentId?: string | null;
  provider?: string | null;
  role?: string;
  threadId?: string | null;
  topicId?: string | null;
}

export interface CreateAssistantMessageOptions {
  /**
   * Stable key for one logical assistant output. Persistent transports should
   * return the existing message when a step is delivered more than once.
   */
  idempotencyKey?: string;
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

export interface QueryMessagesOptions {
  /**
   * Return the flattened conversation-flow list. Server adapters can implement
   * this with `@lobechat/conversation-flow`; package executors stay unaware of
   * that dependency.
   */
  flatten?: boolean;
  /** Resolve file-backed fields to external URLs before the next LLM call. */
  resolveAssetUrls?: boolean;
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
  createAssistantMessage: (
    params: CreateMessageParams,
    options?: CreateAssistantMessageOptions,
  ) => Promise<RuntimeMessageRef>;
  createToolMessage: (params: CreateMessageParams) => Promise<RuntimeMessageRef>;
  deleteMessage: (id: string) => Promise<void>;
  /** Existence / parent preflight; returns the id when present. */
  findById: (id: string) => Promise<RuntimeMessageRef | undefined>;
  /**
   * The tool row already holding this call, if one exists.
   *
   * A call's row can be created by several parties — an approval pause, a
   * transport that pre-creates it so the UI has something to render, an earlier
   * step. Asking the store is what makes "exactly one row per `tool_call_id`"
   * hold no matter which of them got there first; the alternative is every
   * caller having to know the whole history, which is how duplicate rows and
   * stranded approval cards happen.
   */
  findToolMessageIdByToolCallId: (
    toolCallId: string,
    /**
     * The assistant message that made the call. Required scope, not a hint:
     * `tool_call_id` is provider-supplied and merely indexed, so an unscoped
     * match can resolve to a reused id from an unrelated turn — and this lookup
     * feeds a write.
     */
    parentMessageId: string,
  ) => Promise<string | undefined>;
  query: (params?: QueryMessagesInput, options?: QueryMessagesOptions) => Promise<UIChatMessage[]>;
  update: (id: string, params: Partial<UpdateMessageParams>) => Promise<void>;
  updatePluginState: (id: string, state: Record<string, any>) => Promise<void>;
  /**
   * Move an existing tool row out of its `pending` approval state.
   *
   * Separate from {@link updateToolMessage} because intervention lives on the
   * plugin row, not the message row. The abort path needs it: a parked approval
   * already has one tool row per pending call, and Stop must settle THOSE rows —
   * inserting fresh aborted rows instead leaves the originals `pending`, so the
   * approval cards never clear.
   */
  updateToolIntervention: (id: string, intervention: Record<string, any>) => Promise<void>;
  updateToolMessage: (id: string, params: UpdateToolMessageInput) => Promise<void>;
}
