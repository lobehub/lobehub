import type { AgentState } from '../types/state';

// ==================== Supervisor Instructions (Output) ====================
// These are the commands that the Supervisor decides to execute

/**
 * Instruction to call the supervisor agent to make a decision
 */
export interface SupervisorInstructionCallSupervisor {
  payload: {
    groupId?: string;
    round: number;
    supervisorAgentId: string;
  };
  type: 'call_supervisor';
}

/**
 * Instruction to call a single agent to respond
 */
export interface SupervisorInstructionCallAgent {
  payload: {
    agentId: string;
    instruction?: string;
  };
  type: 'call_agent';
}

/**
 * Instruction to call multiple agents in parallel (broadcast)
 */
export interface SupervisorInstructionParallelCallAgents {
  payload: {
    agentIds: string[];
    /**
     * Whether to disable tools for broadcast agents
     * When true, agents will respond without calling any tools
     */
    disableTools?: boolean;
    instruction?: string;
    /**
     * The tool message ID that triggered the broadcast
     * Used as parentId for agent responses to build correct message tree
     */
    toolMessageId: string;
  };
  type: 'parallel_call_agents';
}

/**
 * Instruction to execute an async task for an agent (server-side)
 */
export interface SupervisorInstructionExecAsyncTask {
  payload: {
    agentId: string;
    instruction: string;
    timeout?: number;
    /** Task title (shown in UI, used as thread title) */
    title?: string;
    toolMessageId: string;
  };
  type: 'exec_async_task';
}

/**
 * Instruction to execute an async task for an agent on the client (desktop only)
 * Used when task requires local tools like file system or shell commands
 */
export interface SupervisorInstructionExecClientAsyncTask {
  payload: {
    agentId: string;
    instruction: string;
    timeout?: number;
    /** Task title (shown in UI, used as thread title) */
    title?: string;
    toolMessageId: string;
  };
  type: 'exec_client_async_task';
}

/**
 * Instruction to execute multiple async tasks in parallel
 */
export interface SupervisorInstructionBatchExecAsyncTasks {
  payload: {
    tasks: Array<{
      agentId: string;
      instruction: string;
      timeout?: number;
      /** Task title (shown in UI, used as thread title) */
      title?: string;
    }>;
    toolMessageId: string;
  };
  type: 'batch_exec_async_tasks';
}

/**
 * Instruction to delegate control to another agent
 */
export interface SupervisorInstructionDelegate {
  payload: {
    agentId: string;
    reason?: string;
  };
  type: 'delegate';
}

/**
 * Instruction to end the orchestration loop
 */
export interface SupervisorInstructionFinish {
  reason: string;
  type: 'finish';
}

/**
 * Union type of all Supervisor Instructions
 */
export type SupervisorInstruction =
  | SupervisorInstructionCallSupervisor
  | SupervisorInstructionCallAgent
  | SupervisorInstructionParallelCallAgents
  | SupervisorInstructionExecAsyncTask
  | SupervisorInstructionExecClientAsyncTask
  | SupervisorInstructionBatchExecAsyncTasks
  | SupervisorInstructionDelegate
  | SupervisorInstructionFinish;

// ==================== Executor Results (Input to Supervisor) ====================
// These are the outcomes that Executors report back

/**
 * Result when supervisor made a decision (called a tool like speak/broadcast/delegate)
 */
export interface ExecutorResultSupervisorDecided {
  payload: {
    /**
     * The decision made by the supervisor
     * - 'speak': Call a single agent
     * - 'broadcast': Call multiple agents in parallel
     * - 'delegate': Delegate to another agent
     * - 'execute_task': Execute a single async task
     * - 'execute_tasks': Execute multiple async tasks in parallel
     * - 'finish': End the orchestration
     */
    decision: 'speak' | 'broadcast' | 'delegate' | 'execute_task' | 'execute_tasks' | 'finish';
    /**
     * Parameters for the decision
     */
    params: Record<string, unknown>;
    /**
     * If true, the orchestration will end after the action completes,
     * without calling the supervisor again.
     */
    skipCallSupervisor?: boolean;
  };
  type: 'supervisor_decided';
}

/**
 * Result when a single agent has finished responding
 */
export interface ExecutorResultAgentSpoke {
  payload: {
    agentId: string;
    /**
     * Whether the agent response completed successfully
     */
    completed: boolean;
  };
  type: 'agent_spoke';
}

/**
 * Result when all parallel agents have finished responding
 */
export interface ExecutorResultAgentsBroadcasted {
  payload: {
    agentIds: string[];
    /**
     * Whether all agent responses completed successfully
     */
    completed: boolean;
  };
  type: 'agents_broadcasted';
}

/**
 * Result when an async task has completed
 */
export interface ExecutorResultTaskCompleted {
  payload: {
    agentId: string;
    error?: string;
    result?: string;
    /**
     * Whether the task completed successfully
     */
    success: boolean;
  };
  type: 'task_completed';
}

/**
 * Result when all batch async tasks have completed
 */
export interface ExecutorResultTasksCompleted {
  payload: {
    results: Array<{
      agentId: string;
      error?: string;
      result?: string;
      success: boolean;
    }>;
  };
  type: 'tasks_completed';
}

/**
 * Result when delegation completed
 */
export interface ExecutorResultDelegated {
  payload: {
    agentId: string;
    completed: boolean;
  };
  type: 'delegated';
}

/**
 * Initial result to start the orchestration loop
 */
export interface ExecutorResultInit {
  payload: {
    groupId?: string;
  };
  type: 'init';
}

/**
 * Union type of all Executor Results
 */
export type ExecutorResult =
  | ExecutorResultInit
  | ExecutorResultSupervisorDecided
  | ExecutorResultAgentSpoke
  | ExecutorResultAgentsBroadcasted
  | ExecutorResultTaskCompleted
  | ExecutorResultTasksCompleted
  | ExecutorResultDelegated;

// ==================== Runtime Types ====================

/**
 * Group Orchestration Executor Output
 * Contains the execution result and next context for the runtime loop
 */
export interface GroupOrchestrationExecutorOutput {
  /**
   * Events that occurred during execution
   */
  events: GroupOrchestrationEvent[];
  /**
   * Updated state after execution
   */
  newState: AgentState;
  /**
   * The result to be passed to the Supervisor for the next decision
   * If undefined, the orchestration loop should end
   */
  result?: ExecutorResult;
}

/**
 * Group Orchestration Executor Type
 * Receives a SupervisorInstruction and returns an ExecutorResult
 */
export type GroupOrchestrationExecutor = (
  instruction: SupervisorInstruction,
  state: AgentState,
) => Promise<GroupOrchestrationExecutorOutput>;

/**
 * Group Orchestration Supervisor Interface
 * Receives an ExecutorResult and returns a SupervisorInstruction
 */
export interface IGroupOrchestrationSupervisor {
  /**
   * Decide the next instruction based on the executor result
   * @param result - The result from the last executor
   * @param state - Current agent state
   * @returns The next instruction to execute
   */
  decide: (result: ExecutorResult, state: AgentState) => Promise<SupervisorInstruction>;
}

/**
 * Group Orchestration Runtime Config
 */
export interface GroupOrchestrationRuntimeConfig {
  executors: Partial<Record<SupervisorInstruction['type'], GroupOrchestrationExecutor>>;
  getOperation?: (operationId: string) => {
    abortController: AbortController;
    context: Record<string, unknown>;
  };
  operationId?: string;
}

// ==================== Event Types ====================

/**
 * Group Orchestration Event Types
 */
export interface GroupOrchestrationEventSupervisorFinished {
  type: 'supervisor_finished';
}

export interface GroupOrchestrationEventAgentSpoke {
  agentId: string;
  type: 'agent_spoke';
}

export interface GroupOrchestrationEventAgentsBroadcasted {
  agentIds: string[];
  type: 'agents_broadcasted';
}

export interface GroupOrchestrationEventMaxRoundsExceeded {
  type: 'max_rounds_exceeded';
}

export interface GroupOrchestrationEventDone {
  reason: string;
  type: 'done';
}

export type GroupOrchestrationEvent =
  | GroupOrchestrationEventAgentSpoke
  | GroupOrchestrationEventAgentsBroadcasted
  | GroupOrchestrationEventDone
  | GroupOrchestrationEventMaxRoundsExceeded
  | GroupOrchestrationEventSupervisorFinished;

// ==================== Legacy Types (for backward compatibility) ====================
// TODO: Remove these after migration is complete

/**
 * @deprecated Use ExecutorResult instead
 */
export type GroupOrchestrationPhase =
  | 'call_supervisor'
  | 'speak'
  | 'broadcast'
  | 'delegate'
  | 'agent_spoke'
  | 'agents_broadcasted'
  | 'execute_task';

/**
 * @deprecated Use ExecutorResult instead
 */
export interface GroupOrchestrationContext {
  operationId?: string;
  payload?: Record<string, unknown>;
  phase: GroupOrchestrationPhase | string;
}

/**
 * @deprecated Use SupervisorInstruction instead
 */
export type GroupOrchestrationInstruction = SupervisorInstruction;

/**
 * @deprecated Use GroupOrchestrationExecutorOutput instead
 */
export interface GroupOrchestrationExecutorResult {
  events: GroupOrchestrationEvent[];
  newState: AgentState;
  nextContext?: GroupOrchestrationContext;
}
