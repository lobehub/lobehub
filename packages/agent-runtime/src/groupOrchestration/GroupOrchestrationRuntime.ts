import type { AgentState } from '../types/state';
import type {
  ExecutorResult,
  GroupOrchestrationExecutor,
  GroupOrchestrationExecutorOutput,
  GroupOrchestrationRuntimeConfig,
  IGroupOrchestrationSupervisor,
  SupervisorInstruction,
} from './types';

/**
 * GroupOrchestrationRuntime - Specialized Runtime for Multi-Agent collaboration
 *
 * Architecture:
 * - Supervisor (State Machine): Receives ExecutorResult → Returns SupervisorInstruction
 * - Executor (Execution Layer): Receives SupervisorInstruction → Returns ExecutorResult
 * - Runtime: Orchestrates the loop between Supervisor and Executor
 *
 * Flow:
 * 1. Start with 'init' result
 * 2. Supervisor decides next instruction based on result
 * 3. Executor executes the instruction
 * 4. Executor returns result
 * 5. Repeat from step 2 until Supervisor returns 'finish' instruction
 */
export class GroupOrchestrationRuntime {
  private executors: Partial<Record<SupervisorInstruction['type'], GroupOrchestrationExecutor>>;
  private operationId?: string;
  private getOperation?: GroupOrchestrationRuntimeConfig['getOperation'];

  constructor(
    private supervisor: IGroupOrchestrationSupervisor,
    private config: GroupOrchestrationRuntimeConfig,
  ) {
    this.operationId = config.operationId;
    this.getOperation = config.getOperation;
    this.executors = config.executors;
  }

  /**
   * Execute a single step of the orchestration loop
   *
   * @param state - Current agent state
   * @param result - The result from the previous step (or 'init' for the first step)
   * @returns The executor output containing new state and next result
   */
  async step(state: AgentState, result: ExecutorResult): Promise<GroupOrchestrationExecutorOutput> {
    // 1. Increment step count
    const newState = structuredClone(state);
    newState.stepCount = (newState.stepCount || 0) + 1;
    newState.lastModified = new Date().toISOString();

    // 2. Check max steps limit
    if (newState.maxSteps && newState.stepCount > newState.maxSteps) {
      newState.status = 'done';
      return {
        events: [
          {
            reason: `Maximum steps exceeded: ${newState.maxSteps}`,
            type: 'done',
          },
        ],
        newState,
        result: undefined,
      };
    }

    // 3. Get instruction from supervisor based on result
    const instruction = await this.supervisor.decide(result, newState);

    // 4. Check if we should finish
    if (instruction.type === 'finish') {
      newState.status = 'done';
      return {
        events: [
          {
            reason: instruction.reason,
            type: 'done',
          },
        ],
        newState,
        result: undefined,
      };
    }

    // 5. Get executor for instruction type
    const executor = this.executors[instruction.type];
    if (!executor) {
      throw new Error(`No executor found for instruction type: ${instruction.type}`);
    }

    // 6. Execute instruction
    const executorOutput = await executor(instruction, newState);

    // 7. Preserve step count and lastModified
    executorOutput.newState.stepCount = newState.stepCount;
    executorOutput.newState.lastModified = newState.lastModified;

    return executorOutput;
  }

  /**
   * Run the full orchestration loop until completion
   *
   * @param initialState - Initial agent state
   * @param groupId - Optional group ID for the orchestration
   * @returns Final agent state after orchestration completes
   */
  async run(initialState: AgentState, groupId?: string): Promise<AgentState> {
    let state = initialState;
    let result: ExecutorResult | undefined = {
      payload: { groupId },
      type: 'init',
    };

    while (result) {
      const output = await this.step(state, result);
      state = output.newState;
      result = output.result;

      // Check for abort
      const abortController = this.getAbortController();
      if (abortController?.signal.aborted) {
        state.status = 'done';
        break;
      }
    }

    return state;
  }

  /**
   * Get operation context
   */
  getContext(): Record<string, unknown> | undefined {
    if (!this.operationId || !this.getOperation) {
      return undefined;
    }
    return this.getOperation(this.operationId).context;
  }

  /**
   * Get operation abort controller
   */
  getAbortController(): AbortController | undefined {
    if (!this.operationId || !this.getOperation) {
      return undefined;
    }
    return this.getOperation(this.operationId).abortController;
  }

  /**
   * Create initial state for group orchestration
   */
  static createInitialState(
    partialState?: Partial<AgentState> & { operationId: string },
  ): AgentState {
    const now = new Date().toISOString();
    return {
      cost: {
        calculatedAt: now,
        currency: 'USD',
        llm: { byModel: [], currency: 'USD', total: 0 },
        tools: { byTool: [], currency: 'USD', total: 0 },
        total: 0,
      },
      createdAt: now,
      lastModified: now,
      messages: [],
      status: 'idle',
      stepCount: 0,
      toolManifestMap: {},
      usage: {
        humanInteraction: {
          approvalRequests: 0,
          promptRequests: 0,
          selectRequests: 0,
          totalWaitingTimeMs: 0,
        },
        llm: {
          apiCalls: 0,
          processingTimeMs: 0,
          tokens: { input: 0, output: 0, total: 0 },
        },
        tools: {
          byTool: [],
          totalCalls: 0,
          totalTimeMs: 0,
        },
      },
      ...(partialState || { operationId: '' }),
    };
  }
}
