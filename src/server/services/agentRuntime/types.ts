import { type AgentRuntimeContext, type AgentState } from '@lobechat/agent-runtime';
import type { LobeToolManifest, OperationSkillSet } from '@lobechat/context-engine';
import { type UserInterventionConfig } from '@lobechat/types';

import { type ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';

import { type AgentHook } from './hooks/types';

// ==================== Operation Tool Set ====================

export interface OperationToolSet {
  enabledToolIds?: string[];
  manifestMap: Record<string, LobeToolManifest>;
  sourceMap?: Record<string, 'builtin' | 'plugin' | 'mcp' | 'klavis' | 'lobehubSkill'>;
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
  | 'waiting_for_human';

// ==================== Execution Params ====================

export interface AgentExecutionParams {
  approvedToolCall?: any;
  context?: AgentRuntimeContext;
  humanInput?: any;
  operationId: string;
  rejectionReason?: string;
  stepIndex: number;
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

export interface OperationCreationParams {
  activeDeviceId?: string;
  agentConfig?: any;
  appContext: {
    agentId?: string;
    groupId?: string | null;
    taskId?: string;
    threadId?: string | null;
    topicId?: string | null;
    trigger?: string;
  };
  autoStart?: boolean;
  /** Bot platform context for injecting platform capabilities (e.g. markdown support) */
  botPlatformContext?: any;
  /**
   * Completion webhook configuration
   * When set, an HTTP POST will be fired when the operation completes (success or error).
   * The webhook is persisted in Redis state so it survives across QStash step boundaries.
   */
  completionWebhook?: {
    body?: Record<string, unknown>;
    url: string;
  };
  /** Device system info for placeholder variable replacement in Local System systemRole */
  deviceSystemInfo?: Record<string, string>;
  /** Discord context for injecting channel/guild info into agent system message */
  discordContext?: any;
  evalContext?: any;
  /**
   * External lifecycle hooks
   * Registered once, auto-adapt to local (in-memory) or production (webhook) mode
   */
  hooks?: AgentHook[];
  initialContext: AgentRuntimeContext;
  initialMessages?: any[];
  maxSteps?: number;
  modelRuntimeConfig?: any;
  operationId: string;
  /** Operation-level skill set for SkillResolver */
  operationSkillSet?: OperationSkillSet;
  /** Abort startup before the first step is scheduled */
  signal?: AbortSignal;
  /**
   * Step lifecycle callbacks
   * Used to inject custom logic at different stages of step execution
   */
  stepCallbacks?: StepLifecycleCallbacks;
  /**
   * Step webhook configuration
   * When set, an HTTP POST will be fired after each step completes.
   * Persisted in Redis state so it survives across QStash step boundaries.
   */
  stepWebhook?: {
    body?: Record<string, unknown>;
    url: string;
  };
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
   * Webhook delivery method.
   * - 'fetch': plain HTTP POST (default)
   * - 'qstash': deliver via QStash publishJSON for guaranteed delivery
   */
  webhookDelivery?: 'fetch' | 'qstash';
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
