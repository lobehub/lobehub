import { type AgentRuntimeContext, type AgentState } from '@lobechat/agent-runtime';
import type {
  AgentGroupConfig,
  BotPlatformContext,
  LobeToolManifest,
  OperationSkillSet,
  ToolExecutor,
  ToolSource,
} from '@lobechat/context-engine';
import type { ChatTopicBotContext, UserInterventionConfig } from '@lobechat/types';

import type { ExecutionPlan } from '@/helpers/executionTarget';
import { type ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';
import type { AgentSignalOperationMarker } from '@/server/services/agentSignal/operationMarker';
import type { DeviceAccessReason } from '@/server/services/aiAgent/deviceAccessPolicy';

import { type AgentHook } from './hooks/types';

// ==================== Operation Tool Set ====================

export interface OperationToolSet {
  enabledToolIds?: string[];
  executorMap?: Record<string, ToolExecutor>;
  manifestMap: Record<string, LobeToolManifest>;
  sourceMap?: Record<string, ToolSource>;
  tools?: any[];
}

// ==================== Step Lifecycle Callbacks ====================

/**
 * Step execution lifecycle callbacks
 * Used to inject custom logic at different stages of step execution
 */
export interface StepPresentationData {
  /** LLM text output (undefined if this was a tool step) */
  content?: string;
  /** This step's execution time in ms */
  executionTimeMs: number;
  /** LLM reasoning / thinking content (undefined if none) */
  reasoning?: string;
  /** This step's cost (LLM steps only) */
  stepCost?: number;
  /** This step's input tokens (LLM steps only) */
  stepInputTokens?: number;
  /** This step's output tokens (LLM steps only) */
  stepOutputTokens?: number;
  /** This step's total tokens (LLM steps only) */
  stepTotalTokens?: number;
  /** What this step executed */
  stepType: 'call_llm' | 'call_tool';
  /** true = next step is LLM thinking; false = next step is tool execution */
  thinking: boolean;
  /** Tools the LLM decided to call (undefined if no tool calls) */
  toolsCalling?: Array<{ apiName: string; arguments?: string; identifier: string }>;
  /** Results from tool execution (only for call_tool steps) */
  toolsResult?: Array<{
    apiName: string;
    identifier: string;
    isSuccess?: boolean;
    output?: string;
  }>;
  /** Cumulative total cost */
  totalCost: number;
  /** Cumulative input tokens */
  totalInputTokens: number;
  /** Cumulative output tokens */
  totalOutputTokens: number;
  /** Total steps executed so far */
  totalSteps: number;
  /** Cumulative total tokens */
  totalTokens: number;
}

export interface StepLifecycleCallbacks {
  /**
   * Called after step execution
   */
  onAfterStep?: (
    params: StepPresentationData & {
      operationId: string;
      shouldContinue: boolean;
      state: AgentState;
      stepIndex: number;
      stepResult: any;
    },
  ) => Promise<void>;

  /**
   * Called before step execution
   */
  onBeforeStep?: (params: {
    context?: AgentRuntimeContext;
    operationId: string;
    state: AgentState;
    stepIndex: number;
  }) => Promise<void>;

  /**
   * Called when operation completes (status changes to done/error/interrupted)
   */
  onComplete?: (params: {
    finalState: AgentState;
    operationId: string;
    reason: StepCompletionReason;
  }) => Promise<void>;
}

/**
 * Step completion reason
 */
export type StepCompletionReason =
  | 'done'
  | 'error'
  | 'interrupted'
  | 'max_steps'
  | 'cost_limit'
  | 'waiting_for_human'
  | 'waiting_for_async_tool';

// ==================== Execution Params ====================

export interface AgentExecutionParams {
  approvedToolCall?: any;
  /**
   * 1-based attempt number carried by a `verifyAsyncToolBarrier` re-check so the
   * bounded watchdog can back off and stop after a fixed number of tries. Absent
   * (treated as attempt 1) on the first re-check armed by a completion bridge.
   */
  asyncToolVerifyAttempt?: number;
  context?: AgentRuntimeContext;
  externalRetryCount?: number;
  /**
   * Finish (rather than resume) a `waiting_for_async_tool` supervisor op after
   * its group members have completed. Used by `skipCallSupervisor` / delegate in
   * group orchestration: the orchestration ends without another supervisor LLM
   * turn. Scheduled by the group-action member barrier via
   * `tryResumeParentFromAsyncTool({ onComplete: 'finish' })`.
   */
  finishAfterAsyncTool?: boolean;
  /**
   * Watchdog payload to enforce a group member's timeout: when the member op
   * hasn't reached a terminal state by its deadline, interrupt it and bridge a
   * `timeout` completion so the parked supervisor resumes/finishes instead of
   * waiting forever. Scheduled by `scheduleGroupMemberTimeout` after the member
   * op is forked.
   */
  groupMemberTimeout?: GroupMemberTimeoutParams;
  humanInput?: any;
  operationId: string;
  /**
   * Whether a rejection should resume execution by treating the rejected tool
   * content as user input (maps to client `rejectAndContinueToolCalling`).
   * When false or unset, a rejection halts the operation.
   */
  rejectAndContinue?: boolean;
  rejectionReason?: string;
  /**
   * Resume a `waiting_for_async_tool` op after its deferred tools (e.g. server
   * sub-agents) have all delivered results. Scheduled by the completion bridge
   * via `tryResumeParentFromAsyncTool`.
   */
  resumeAsyncTool?: boolean;
  stepIndex: number;
  /** ID of the pending tool message targeted by the intervention. */
  toolMessageId?: string;
  /**
   * Watchdog re-check for a parked `waiting_for_async_tool` op: re-runs the
   * resume barrier + CAS without claiming the step lock or executing a step.
   * A no-op when the op already resumed. While the barrier is still unsatisfied
   * it re-arms the next check with exponential backoff (see
   * `asyncToolVerifyAttempt`) up to a bounded number of attempts, so a transient
   * miss is retried rather than permanently stranding the parent. First armed by
   * `tryResumeParentFromAsyncTool` when a sub-agent completion found the parent
   * not yet resumable (covers the child-finishes-before-parent-parks race and
   * transient barrier failures).
   */
  verifyAsyncToolBarrier?: boolean;
}

export interface AgentExecutionResult {
  /**
   * When true, the step was already being executed by another instance (lock conflict).
   * The caller should return 429 to force QStash to retry later.
   */
  locked?: boolean;
  nextStepScheduled: boolean;
  state: any;
  stepResult?: any;
  success: boolean;
}

/**
 * Params for the sub-agent completion bridge — see
 * `AgentRuntimeService.completeSubAgentBridge`.
 */
export interface SubAgentBridgeParams {
  /** Child op's final state — passed in local mode; loaded from the coordinator otherwise. */
  finalState?: AgentState;
  /** Child (sub-agent) operation ID. */
  operationId: string;
  parentOperationId: string;
  reason: string;
  threadId: string;
  /** The parent's placeholder `role: 'tool'` message to backfill. */
  toolMessageId: string;
}

// ==================== Group Orchestration (call agent member) ====================

/** Whether a group member runs in the shared group session or an isolated thread. */
export type GroupActionMemberMode = 'in_group' | 'isolated';

/** Whether the supervisor resumes or finishes once all members complete. */
export type GroupActionOnComplete = 'resume' | 'finish';

/**
 * Params for the group-action member completion bridge — see
 * `AgentRuntimeService.completeGroupActionMember`. Mirrors the sub-agent bridge
 * but enforces a K=N member barrier: each member backfills its own anchor, and
 * the supervisor's group tool message is only backfilled (which satisfies the
 * parked op's barrier) once every member's anchor is fulfilled.
 */
export interface GroupActionMemberBridgeParams {
  /**
   * The per-member anchor `role: 'tool'` message to backfill. Equals
   * `groupToolMessageId` when `expectedMembers === 1` (single-member actions
   * collapse the anchor onto the group tool call itself).
   */
  anchorMessageId: string;
  /** Total members forked under this group tool call — the K=N barrier target. */
  expectedMembers: number;
  /** Child member op's final state — passed in local mode; loaded otherwise. */
  finalState?: AgentState;
  /** The supervisor's parked group-management tool message (`tool_call_id` = call id). */
  groupToolMessageId: string;
  /** in_group → backfill a short note; isolated → backfill the member's final answer. */
  mode: GroupActionMemberMode;
  /** Resume the supervisor LLM, or finish the orchestration (skipCallSupervisor/delegate). */
  onComplete: GroupActionOnComplete;
  /** Child (member) operation ID. */
  operationId: string;
  parentOperationId: string;
  reason: string;
  /** Isolation thread id (isolated mode only). */
  threadId?: string;
}

/**
 * Watchdog payload that enforces a group member's timeout. Scheduled after an
 * isolated member op is forked; when it fires, if the member op hasn't reached a
 * terminal state it is interrupted and a `timeout` completion is bridged so the
 * parked supervisor resumes/finishes (satisfying the K=N barrier) instead of
 * waiting indefinitely.
 */
export interface GroupMemberTimeoutParams {
  anchorMessageId: string;
  expectedMembers: number;
  groupToolMessageId: string;
  /** The forked member operation id whose deadline this enforces. */
  memberOperationId: string;
  mode: GroupActionMemberMode;
  onComplete: GroupActionOnComplete;
  parentOperationId: string;
}

/**
 * Params handed to the {@link AgentRuntimeDelegate.execGroupMember} callback —
 * fork one group member (in-group or isolated) under a group-management tool
 * call, installing the group-action member completion bridge.
 */
export interface ExecGroupMemberParams {
  /** Member agent id. */
  agentId: string;
  /** Per-member anchor message id the bridge backfills. */
  anchorMessageId: string;
  /** Disable tools for this member (broadcast — voice opinions only). */
  disableTools?: boolean;
  /** K=N barrier target stored on the group tool message. */
  expectedMembers: number;
  /** Group id. */
  groupId: string;
  /** Supervisor's group-management tool message id (the parked tool call). */
  groupToolMessageId: string;
  /** Optional supervisor instruction guiding the member's response. */
  instruction?: string;
  /** in_group (non-isolated group session) or isolated (own thread). */
  mode: GroupActionMemberMode;
  /** Resume or finish the supervisor once all members complete. */
  onComplete: GroupActionOnComplete;
  /** Parent (supervisor) operation id. */
  parentOperationId: string;
  /** Per-member timeout (ms), isolated mode. */
  timeout?: number;
  /** Group topic id. */
  topicId: string;
}

export interface ExecGroupMemberResult {
  error?: string;
  /** Forked member operation id (when started). */
  operationId?: string;
  /** Whether the member op was forked. */
  started: boolean;
  /** Isolation thread id (isolated mode only). */
  threadId?: string;
}

export interface OperationCreationParams {
  activeDeviceId?: string;
  agentConfig?: any;
  /**
   * Multi-agent group (or bot-conversation fallback) context, resolved once at
   * op creation and forwarded into `state.metadata.agentGroup`. The per-step
   * context engine reads it back to inject the participant roster (with real
   * `agt_*` IDs) — no per-step DB lookup, mirroring `botContext`.
   */
  agentGroup?: AgentGroupConfig;
  appContext: {
    agentId?: string;
    /**
     * Run-scoped Agent Signal marker. Stamped at dispatch for background
     * self-iteration / memory runs; lands in `state.metadata.agentSignal` and is
     * read on the completion path to project receipts.
     */
    agentSignal?: AgentSignalOperationMarker;
    defaultTaskAssigneeAgentId?: string;
    documentId?: string | null;
    groupId?: string | null;
    isSubAgent?: boolean;
    /**
     * Group orchestration role, spread onto `state.metadata.orchestrationRole`.
     * Lets the inactivity-watchdog abandon path tell an isolated group member
     * (`'member'`, resumed via the group K=N bridge) apart from a genuine
     * callSubAgent child (which shares `isSubAgent: true`).
     */
    orchestrationRole?: 'supervisor' | 'member';
    scope?: string | null;
    /** Source user message ID used for same-turn Agent Signal procedure suppression. */
    sourceMessageId?: string;
    taskId?: string;
    threadId?: string | null;
    topicId?: string | null;
    trigger?: string;
  };
  autoStart?: boolean;
  /**
   * Sender/owner identity for bot-originated runs. Forwarded into
   * `state.metadata.botContext` so device-tool dispatch can audit who
   * triggered the call. `undefined` for first-party (web/desktop) callers.
   */
  botContext?: ChatTopicBotContext;
  /** Bot platform context for injecting platform capabilities (e.g. markdown support) */
  botPlatformContext?: BotPlatformContext;
  /**
   * Device-access policy decision computed once per turn by
   * `resolveDeviceAccessPolicy`. Forwarded into `state.metadata.deviceAccessPolicy`
   * so the dispatch site can include `reason` in the audit entry without
   * re-deriving it.
   */
  deviceAccessPolicy?: { canUseDevice: boolean; reason: DeviceAccessReason };
  /** Device system info for placeholder variable replacement in Local System systemRole */
  deviceSystemInfo?: Record<string, string>;
  /** Discord context for injecting channel/guild info into agent system message */
  discordContext?: any;
  evalContext?: any;
  /**
   * Resolved execution plan for the run (see `resolveExecutionPlan`).
   * Forwarded into `state.metadata.executionPlan` so step-level layers (the
   * `call_llm` device-tool injection) consume the plan instead of re-deriving
   * device capability from raw config.
   */
  executionPlan?: ExecutionPlan;
  /**
   * External lifecycle hooks
   * Registered once, auto-adapt to local (in-memory) or production (webhook) mode
   */
  hooks?: AgentHook[];
  initialContext: AgentRuntimeContext;
  initialMessages?: any[];
  /** Initial step count offset for resumed operations (accumulated from previous runs) */
  initialStepCount?: number;
  maxSteps?: number;
  modelRuntimeConfig?: any;
  operationId: string;
  /** Operation-level skill set for SkillResolver */
  operationSkillSet?: OperationSkillSet;
  /**
   * Operation ID of the parent run when this operation is a sub-agent
   * invocation (e.g. spawned via `execSubAgent`). Persisted to
   * `agent_operations.parent_operation_id` so analytics can join the
   * sub-tree back to its root.
   */
  parentOperationId?: string;
  queueRetries?: number;
  queueRetryDelay?: string;
  /** Abort startup before the first step is scheduled */
  signal?: AbortSignal;
  /**
   * Whether the LLM call should use streaming.
   * Defaults to true. Set to false for non-streaming scenarios (e.g., bot integrations).
   */
  stream?: boolean;
  toolSet: OperationToolSet;
  userId?: string;
  /**
   * User intervention configuration
   * Controls how tools requiring approval are handled
   * Use { approvalMode: 'headless' } for async tasks that should never wait for human approval
   */
  userInterventionConfig?: UserInterventionConfig;
  /** User memory (persona) for injection into LLM context */
  userMemory?: ServerUserMemoryConfig;
  /** User's timezone from settings (e.g. 'Asia/Shanghai') */
  userTimezone?: string;
  /**
   * Workspace ID propagated down from the originating chat/task router so
   * tool executions (createBrief / pinTask / etc.) ownership-filter to the
   * caller's workspace. Stored on `state.metadata.workspaceId`.
   */
  workspaceId?: string;
}

export interface OperationCreationResult {
  autoStarted: boolean;
  messageId?: string;
  operationId: string;
  success: boolean;
}

export interface OperationStatusResult {
  currentState: {
    cost?: any;
    costLimit?: any;
    error?: string;
    interruption?: any;
    lastModified: string;
    maxSteps?: number;
    pendingHumanPrompt?: any;
    pendingHumanSelect?: any;
    pendingToolsCalling?: any;
    status: string;
    stepCount: number;
    usage?: any;
  };
  executionHistory?: any[];
  hasError: boolean;
  isActive: boolean;
  isCompleted: boolean;
  metadata: any;
  needsHumanInput: boolean;
  operationId: string;
  recentEvents?: any[];
  stats: {
    lastActiveTime: number;
    totalCost: number;
    totalMessages: number;
    totalSteps: number;
    uptime: number;
  };
}

export interface PendingInterventionsResult {
  pendingInterventions: Array<{
    lastModified: string;
    modelRuntimeConfig?: any;
    operationId: string;
    pendingHumanPrompt?: any;
    pendingHumanSelect?: any;
    pendingToolsCalling?: any[];
    status: string;
    stepCount: number;
    type: 'tool_approval' | 'human_prompt' | 'human_select';
    userId?: string;
  }>;
  timestamp: string;
  totalCount: number;
}

export interface StartExecutionParams {
  context?: AgentRuntimeContext;
  delay?: number;
  operationId: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface StartExecutionResult {
  messageId?: string;
  operationId: string;
  scheduled: boolean;
  success: boolean;
}
