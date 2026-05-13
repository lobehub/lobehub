import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload, type ClientSecretPayload } from '@lobechat/types';

export interface ToolExecutionMemoryEmbeddingRuntime {
  /** Embedding model id used by the memory search runtime. */
  model: string;
  /** Provider credentials/config supplied by the trusted server caller. */
  payload: ClientSecretPayload;
  /** Model provider used to initialize the embedding runtime. */
  provider: string;
}

export interface ToolExecutionContext {
  /** Target device ID for device proxy tool calls */
  activeDeviceId?: string;
  /** Agent ID executing the tool call */
  agentId?: string;
  /** Current page document ID for page-scoped conversations */
  documentId?: string | null;
  /** Current group ID for group chat context */
  groupId?: string | null;
  /**
   * Optional server-owned embedding runtime for memory search.
   *
   * Use when the acting user is synthetic and should not read user key vaults.
   */
  memoryEmbeddingRuntime?: ToolExecutionMemoryEmbeddingRuntime;
  /** Memory tool permission from agent chat config */
  memoryToolPermission?: 'read-only' | 'read-write';
  /** Source user message ID used by Agent Signal procedure suppression. */
  messageId?: string;
  /** Agent runtime operation ID for structured tool outcome identity. */
  operationId?: string;
  /** Conversation scope captured when the operation was created */
  scope?: string | null;
  /** Server database for LobeHub Skills execution */
  serverDB?: LobeChatDatabase;
  /** Task ID when executing within the Task system */
  taskId?: string;
  /** Current thread ID for thread-scoped conversations */
  threadId?: string | null;
  /** Stable LLM tool call ID for structured tool outcome identity. */
  toolCallId?: string;
  toolManifestMap: Record<string, LobeToolManifest>;
  /**
   * Maximum length for tool execution result content (in characters)
   * @default 6000
   */
  toolResultMaxLength?: number;
  /** Topic ID for sandbox session management */
  topicId?: string;
  userId?: string;
}

export interface ToolExecutionResult {
  content: string;
  error?: any;
  state?: Record<string, any>;
  success: boolean;
}

export interface ToolExecutionResultResponse extends ToolExecutionResult {
  executionTime: number;
}

export interface IToolExecutor {
  execute: (
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}
