import type { RuntimeStepContext } from '../stepContext';
import type {
  AfterCompletionCallback,
  GroupOrchestrationCallbacks,
  SubAgentCallbacks,
} from './builtin';

/**
 * Executor types extracted from `builtin.ts` (source-layout §3: that file was
 * already over the 800-line limit and must not grow).
 */
// ==================== Executor Types ====================

/**
 * Result returned by builtin tool executors
 */
export interface BuiltinToolResult {
  /**
   * The content to display in the tool message
   */
  content?: string;

  /**
   * When true, the tool's real result is delivered out-of-band later (e.g. a
   * sub-agent that parked on human approval). The client runtime parks the
   * operation (`waiting_for_async_tool`) instead of settling the tool call,
   * and a completion bridge backfills the tool message + resumes the parent —
   * mirroring the server runtime's deferred-tool path. The `content` written
   * here is the placeholder the parked parent shows while waiting.
   */
  deferred?: boolean;

  /**
   * Error information if the tool execution failed
   */
  error?: {
    body?: any;
    message: string;
    type: string;
  };

  /**
   * Metadata to attach to the tool message
   * Used to mark messages for special handling (e.g., agentCouncil for parallel display)
   */
  metadata?: Record<string, any>;

  /**
   * Plugin state for UI rendering
   */
  state?: any;

  /**
   * Whether to stop the current execution flow
   * - true: Stop execution (e.g., speak/broadcast in group management)
   * - false/undefined: Continue execution
   */
  stop?: boolean;

  /**
   * Whether the tool execution was successful
   */
  success: boolean;
}

/**
 * Context passed to builtin tool executors
 */
export interface BuiltinToolContext {
  /**
   * The current agent ID executing this tool (supervisor agent in group context)
   * Used to identify which agent called the tool for orchestration purposes
   */
  agentId?: string;

  /** Assistant message that owns this tool call. */
  anchorMessageId?: string;

  /**
   * The current page document ID when the conversation is scoped to an open editor
   * Uses the underlying `documents.id`, not tool-specific association IDs
   */
  documentId?: string | null;

  /**
   * The current group ID (only available in group chat context)
   * Used by group management tools to access group member information
   */
  groupId?: string;

  /**
   * Group orchestration callbacks (only available in group chat context)
   * Used by group management tools to trigger the next orchestration phase
   */
  groupOrchestration?: GroupOrchestrationCallbacks;

  /**
   * Whether the current tool is executing inside a sub-agent. Sub-agents must
   * not spawn additional sub-agents.
   */
  isSubAgent?: boolean;

  /**
   * The run executes on this machine AND its owner asked for the device sandbox
   * (`agencyConfig.localSandbox` on a `local` target). The Local System executor
   * forwards it to `runCommand` so the desktop confines the spawned command.
   *
   * Resolved by the caller that builds this context — the executor must not
   * re-derive it, so the in-process path and the server device-proxy stay in
   * agreement about which runs are fenced.
   */
  localSandbox?: boolean;

  /**
   * The fenced run may reach the package-registry allowlist
   * (`agencyConfig.localSandboxNetwork`). Meaningless without
   * {@link localSandbox}.
   */
  localSandboxNetwork?: boolean;

  /**
   * Tool execution context key. It is the tool message ID for locally persisted
   * tool messages, but gateway execution can temporarily use the toolCallId
   * before the server-side tool result message exists.
   */
  messageId: string;

  /**
   * Optional callback for streaming updates
   * Only needed for tools that support streaming output
   */
  onStreamingUpdate?: (chunk: string) => Promise<void>;

  /**
   * The current operation ID (for abort signal)
   */
  operationId?: string;

  /**
   * Current plugin state for this tool message
   * Use `stepContext` instead for cross-message state
   */
  pluginState?: Record<string, unknown>;

  /**
   * Register a callback to execute after AgentRuntime completes
   * Used for actions that should happen after the current execution flow finishes
   * to avoid race conditions with message updates
   */
  registerAfterCompletion?: (callback: AfterCompletionCallback) => void;

  /**
   * Root AI runtime operation ID for aggregating artifacts produced by one run.
   */
  rootOperationId?: string;

  /**
   * Conversation scope captured when the operation was created
   */
  scope?: string | null;

  /**
   * AbortSignal for cancellation detection
   */
  signal?: AbortSignal;

  /**
   * The source user message ID for tools that need to inspect the current turn.
   */
  sourceMessageId?: string;

  /**
   * Step context computed at the beginning of each step
   * Contains dynamic state like lobe-agent todos that changes between steps
   * Computed by AgentRuntime and passed to Tool Executors
   */
  stepContext?: RuntimeStepContext;

  /**
   * Sub-agent execution callback injected by the client runtime.
   * Lets a tool (e.g. lobe-agent.callSubAgent) recursively run a sub-agent in
   * an isolated thread using the *current* runtime, then resume as a normal
   * tool result. Only present during client-mode tool execution.
   */
  subAgent?: SubAgentCallbacks;

  /**
   * Current task identifier or database id when the conversation is scoped to a task detail page.
   */
  taskId?: string | null;

  /**
   * The current thread ID when operating inside a thread-scoped conversation.
   */
  threadId?: string | null;

  /**
   * The tool call ID from the assistant message.
   */
  toolCallId?: string;

  /**
   * Explicit source tool message ID for provenance. Prefer this over `messageId`
   * when persisting cross-domain records because gateway tool execution may use
   * `messageId` as a client-side context key before the server creates the tool
   * message row.
   */
  toolMessageId?: string;

  /**
   * The current topic ID (only available when operating within a topic)
   * Used by tools that need to create messages or operations within a topic
   */
  topicId?: string | null;

  /**
   * The working directory configured for file operations
   * When set, file operations should be restricted to this directory
   */
  workingDirectory?: string;
}
