import { type AgentRuntimeContext, type AgentState } from '@lobechat/agent-runtime';
import { type LobeToolManifest } from '@lobechat/context-engine';
import { type UserInterventionConfig } from '@lobechat/types';

// ==================== Step Lifecycle Callbacks ====================

/**
 * Step execution lifecycle callbacks
 * Used to inject custom logic at different stages of step execution
 */
export interface StepLifecycleCallbacks {
  /**
   * Called after step execution
   */
  onAfterStep?: (params: {
    operationId: string;
    shouldContinue: boolean;
    state: AgentState;
    stepIndex: number;
    stepResult: any;
  }) => Promise<void>;

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
  nextStepScheduled: boolean;
  state: any;
  stepResult?: any;
  success: boolean;
}

export interface OperationCreationParams {
  agentConfig?: any;
  appContext: {
    agentId?: string;
    groupId?: string | null;
    threadId?: string | null;
    topicId?: string | null;
  };
  autoStart?: boolean;
  initialContext: AgentRuntimeContext;
  initialMessages?: any[];
  modelRuntimeConfig?: any;
  operationId: string;
  /**
   * Step lifecycle callbacks
   * Used to inject custom logic at different stages of step execution
   */
  stepCallbacks?: StepLifecycleCallbacks;
  toolManifestMap: Record<string, LobeToolManifest>;
  tools?: any[];
  toolSourceMap?: Record<string, 'builtin' | 'plugin' | 'mcp' | 'klavis' | 'lobehubSkill'>;
  userId?: string;
  /**
   * User intervention configuration
   * Controls how tools requiring approval are handled
   * Use { approvalMode: 'headless' } for async tasks that should never wait for human approval
   */
  userInterventionConfig?: UserInterventionConfig;
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
