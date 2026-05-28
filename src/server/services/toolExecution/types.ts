import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  type ChatToolPayload,
  type ClientSecretPayload,
  type ExecSubAgentTaskParams,
} from '@lobechat/types';

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
  /**
   * Spawn a sub-agent as an independent async operation. Injected by the agent
   * runtime (forwarded from `RuntimeExecutorContext.execSubAgentTask`) so the
   * `callSubAgent` server tool can fork a child op without a circular import.
   */
  execSubAgentTask?: (params: ExecSubAgentTaskParams) => Promise<unknown>;
  /** Per-call execution timeout resolved by the agent runtime. */
  executionTimeoutMs?: number;
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
  /**
   * Project-level skills (name + absolute SKILL.md path) discovered on the
   * device filesystem. Used by the Skills runtime to load them on demand via
   * the device gateway. Derived from the operation's skill set.
   */
  projectSkills?: { location: string; name: string }[];
  /** Conversation scope captured when the operation was created */
  scope?: string | null;
  /** Server database for LobeHub Skills execution */
  serverDB?: LobeChatDatabase;
  /** Skip low-level result truncation so the AgentRuntime boundary can archive full content first. */
  skipResultTruncation?: boolean;
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
  /**
   * When true, the result is delivered out-of-band later (e.g. an async
   * sub-agent). The agent runtime parks the operation instead of writing a
   * tool_result. Mirrors the client-tool pause path.
   */
  deferred?: boolean;
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
