import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  type ChatToolPayload,
  type ClientSecretPayload,
  type ExecSubAgentParams,
  type StepActivatedSkill,
  type WorkRegistrationIntent,
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
   * Reason the child failed to start, when `started` is false. Surfaced to the
   * parent agent's tool result so a `callAgent` dispatch failure is diagnosable
   * (e.g. "Agent not found", config/scheduling error) instead of an opaque
   * "failed to start" — see issue #16257.
   */
  error?: string;
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
  /**
   * The placeholder tool message the child was anchored to. Surfaced back up to
   * the runtime so the `pauseForTools` chunk can carry `toolMessageIds` — that is
   * what makes the client refetch and actually put this row in its store, which
   * in turn is what lets live sub-agent progress patch onto it while the parent
   * is parked.
   */
  toolMessageId?: string;
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
  /**
   * Skills activated so far in the conversation (activateSkill /
   * activateTools tool results), extracted by the runtime executors from the
   * operation's message history — the server-side equivalent of the client
   * transport's stepContext. The skills runtime uses this to resolve skill
   * archives for `execScript` (device `prepareSkillDirectory` + sandbox
   * `skillZipUrls`); the raw LLM args never carry it.
   */
  activatedSkills?: StepActivatedSkill[];
  /** Target device ID for device proxy tool calls */
  activeDeviceId?: string;
  /**
   * Principal pool `activeDeviceId` lives in. `personal` when a workspace run
   * was routed to the caller's own device via a per-user `local` override —
   * `resolveRunWorkspaceId` then addresses gateway calls through the personal
   * `(userId, deviceId)` pool instead of the `workspace:<id>` pool, where that
   * device has no connection. Absent on runs without a run-start device (a
   * mid-run activation always picks from the workspace pool).
   */
  activeDeviceScope?: 'personal' | 'workspace';
  /** Agent ID executing the tool call */
  agentId?: string;
  /**
   * Server-side "call agent member" runner, injected per tool call by the agent
   * runtime for group orchestration. The `lobe-group-management` server tool
   * calls `agentMember.run(...)` to fork member op(s) and returns a `deferred`
   * result; the member barrier backfills + resumes/finishes the parked supervisor.
   */
  agentMember?: ServerAgentMemberRunner;
  /**
   * Visibility of the agent executing this tool call. Resolved once per tool
   * call in the runtime executor. Tool runtimes that persist agent side-effects
   * (documents, tasks, etc.) forward this so private-agent output inherits
   * private visibility and public-agent reads are gated away from private data
   * — mirroring the `assertAgentVisibilityCompat` invariant on tasks.
   * `null` when the agent is missing or not visible to the caller.
   */
  agentVisibility?: 'private' | 'public' | null;
  /**
   * The assistant message that carries this tool call (the runtime's
   * `payload.parentMessageId`). Distinct from `messageId`, which is the source
   * *user* message. Tools that need to anchor back to the exact tool-call turn
   * (e.g. createTask recording its `context.origin`) must use this, not
   * `messageId`.
   */
  assistantMessageId?: string;
  /**
   * Whether the run's execution plan is device-capable (`device` or
   * `device-unrouted`) — derived from `state.metadata.executionPlan` by the
   * runtime executors. Device-only skills gate listing/activation/loading on
   * this consistently, so a `device-unrouted` run can activate them before the
   * model routes a device; actual command execution stays gated at the device
   * tool layer. Undefined when the caller carries no execution plan (device
   * gates then fall back to `activeDeviceId`).
   */
  deviceCapable?: boolean;
  /** Current page document ID for page-scoped conversations */
  documentId?: string | null;
  /**
   * When scope is 'agent_builder', the ID of the agent being edited. Kept
   * separate from agentId so message ownership and queryUiMessages remain
   * bound to the builder builtin; only AgentBuilder tool methods read this.
   */
  editingAgentId?: string;
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
  /**
   * Sink for a Work-registration intent produced as a side-effect inside a tool
   * runtime (e.g. the agentDocuments runtime, whose registration is decoupled
   * from the returned tool result). The builtin executor installs this collector
   * before dispatching the runtime call and hoists whatever intent the runtime
   * emits onto {@link ToolExecutionResult.workRegistration}, so it reaches
   * `callTool` / `callToolsBatch` and the Work version is inserted ONCE with cost
   * — the same one-shot path task/skill tools use directly on the result.
   */
  onWorkRegistration?: (intent: WorkRegistrationIntent) => void;
  /** Agent runtime operation ID for structured tool outcome identity. */
  operationId?: string;
  /**
   * Filesystem skills (name + absolute SKILL.md path) discovered on the
   * execution device. Used by the Skills runtime to load them on demand via the
   * device gateway. Derived from the operation's skill set.
   */
  projectSkills?: { location: string; name: string; source?: 'device' | 'project' }[];
  /** Root AI runtime operation ID used to aggregate artifacts produced by one run. */
  rootOperationId?: string;
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
  /** Source tool result message ID, when it already exists. */
  toolMessageId?: string;
  /**
   * Maximum length for tool execution result content (in characters)
   * @default 6000
   */
  toolResultMaxLength?: number;
  /** Topic ID for sandbox session management */
  topicId?: string;
  userId?: string;
  /**
   * Device-bound working directory resolved when the operation was created
   * (`resolveDeviceWorkingDirectory`: topic override > workingDirByDevice >
   * device default). Injected by device-proxy runtimes as the tool call's
   * cwd/scope so commands and file ops land in the bound directory instead of
   * the daemon's `process.cwd()` (= `/` for a Finder/Dock-launched app).
   *
   * NOT the conversation `scope` above — that is the operation's thread/group
   * scope and is unrelated to the filesystem working directory.
   */
  workingDirectory?: string;
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
  /**
   * Transient Work-registration intent produced by the executor and consumed by
   * the agent runtime (`callTool` / `callToolsBatch`) once the tool call's
   * cumulative cost is known, so the Work version is inserted ONCE with its
   * cost. In-memory only: it rides through the in-process executor→runtime
   * boundary and is deliberately NOT persisted with the tool message (which
   * stores only `content` / `state` / `error`) nor length-truncated (unlike
   * `content`), so skill identity in the untruncated payload survives.
   */
  workRegistration?: WorkRegistrationIntent;
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
