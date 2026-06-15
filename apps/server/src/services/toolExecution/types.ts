import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  type ChatToolPayload,
  type ClientSecretPayload,
  type ExecSubAgentParams,
} from '@lobechat/types';

export interface ToolExecutionMemoryEmbeddingRuntime {
  /** Embedding model id used by the memory search runtime. */
  model: string;
  /** Provider credentials/config supplied by the trusted server caller. */
  payload: ClientSecretPayload;
  /** Model provider used to initialize the embedding runtime. */
  provider: string;
}

export interface ServerSubAgentRunParams {
  /** Target agent id; defaults to the parent agent when omitted. */
  agentId?: string;
  /** Short label shown in the UI (sub-agent thread title). */
  description: string;
  /** Detailed instruction/prompt for the sub-agent run. */
  instruction: string;
  /** Optional per-run timeout in milliseconds. */
  timeout?: number;
}

export interface ServerSubAgentRunResult {
  /**
   * Whether the child op was actually forked. `false` means the child failed to
   * start (e.g. the operation row could not be created/scheduled): no completion
   * bridge will ever fire, so the caller must surface an inline tool error
   * instead of parking the parent — otherwise the parent hangs forever.
   */
  started: boolean;
  /** The spawned child operation id. */
  subOperationId?: string;
  /** The isolation thread holding the sub-agent's full message trace. */
  threadId: string;
}

/**
 * Server-side sub-agent runner injected per tool call by the agent runtime.
 *
 * Unlike the client runner (which blocks until the sub-agent finishes), the
 * server runner only kicks off the child operation asynchronously: it creates
 * the pending placeholder tool message that anchors the isolation thread, forks
 * the child op, and returns immediately. The real result is delivered later by
 * the completion bridge, which backfills the placeholder and resumes the parent.
 */
export interface ServerSubAgentRunner {
  run: (params: ServerSubAgentRunParams) => Promise<ServerSubAgentRunResult>;
}

export interface ServerAgentMemberRunItem {
  /** Target group member agent id. */
  agentId: string;
  /** Optional supervisor instruction to guide the member's response. */
  instruction?: string;
}

export interface ServerAgentMemberRunParams {
  /** Disable tools for the members (used by broadcast — members only voice opinions). */
  disableTools?: boolean;
  /** Members to run under the current group-management tool call. */
  members: ServerAgentMemberRunItem[];
  /**
   * Execution mode:
   * - `in_group`: member runs in the shared group session (non-isolated); its
   *   turns land directly in the group conversation. Used by speak/broadcast/delegate.
   * - `isolated`: member runs in its own isolation thread. Used by
   *   executeAgentTask(s).
   */
  mode: 'in_group' | 'isolated';
  /**
   * Whether, once all members complete, the parked supervisor op should
   * `resume` (re-enter the supervisor LLM) or `finish` (end the orchestration
   * without another supervisor turn — for `skipCallSupervisor` / delegate).
   */
  onComplete: 'resume' | 'finish';
  /** Per-member execution timeout (ms), applied to isolated tasks. */
  timeout?: number;
}

export interface ServerAgentMemberRunResult {
  /**
   * Whether at least one member op was forked. `false` means every member
   * failed to start — no completion bridge will fire, so the caller must
   * surface an inline tool error instead of parking the parent.
   */
  started: boolean;
  /** Number of member ops successfully forked. */
  startedCount: number;
}

/**
 * Server-side "call agent member" runner injected per tool call by the agent
 * runtime for group orchestration. Distinct from {@link ServerSubAgentRunner}:
 * a sub-agent is an isolated child run, whereas a group member can run inside
 * the shared group session. The runner creates the per-member anchor messages
 * under the group tool call, forks the member op(s), and returns immediately;
 * the K=N member barrier backfills the group tool message and resumes/finishes
 * the parked supervisor once all members complete.
 */
export interface ServerAgentMemberRunner {
  run: (params: ServerAgentMemberRunParams) => Promise<ServerAgentMemberRunResult>;
}

export interface ToolExecutionContext {
  /** Target device ID for device proxy tool calls */
  activeDeviceId?: string;
  /** Agent ID executing the tool call */
  agentId?: string;
  /**
   * Server-side "call agent member" runner, injected per tool call by the agent
   * runtime for group orchestration. The `lobe-group-management` server tool
   * calls `agentMember.run(...)` to fork member op(s) and returns a `deferred`
   * result; the member barrier backfills + resumes/finishes the parked supervisor.
   */
  agentMember?: ServerAgentMemberRunner;
  /** Current page document ID for page-scoped conversations */
  documentId?: string | null;
  /**
   * Legacy agent invocation callback forwarded from RuntimeExecutorContext.
   * Kept for tool runtimes that still dispatch through exec_sub_agent style
   * flows; `lobe-agent.callSubAgent` uses the per-call `subAgent` runner below.
   */
  execSubAgent?: (params: ExecSubAgentParams) => Promise<unknown>;
  /** Per-call execution timeout resolved by the agent runtime. */
  executionTimeoutMs?: number;
  /** Current group ID for group chat context */
  groupId?: string | null;
  /** Whether this tool call is executing inside an isolated sub-agent run. */
  isSubAgent?: boolean;
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
  /**
   * Server-side sub-agent runner, injected per tool call by the agent runtime
   * (closes over the current tool payload + parent message). The `callSubAgent`
   * server tool calls `subAgent.run(...)` to fork a child op and returns a
   * `deferred` result; the completion bridge backfills + resumes the parent.
   */
  subAgent?: ServerSubAgentRunner;
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
  /**
   * Workspace ID that scopes ownership for any model/service the runtime
   * instantiates. When unset the runtime falls back to personal mode
   * (`workspace_id IS NULL`). Threaded from the chat/task router through
   * `state.metadata.workspaceId` so tool side-effects (createBrief, pinTask,
   * etc.) land in the same workspace the request originated from.
   */
  workspaceId?: string;
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
