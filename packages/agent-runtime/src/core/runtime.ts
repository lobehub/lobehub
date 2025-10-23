import type {
  Agent,
  AgentEvent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  Cost,
  InstructionExecutor,
  RuntimeConfig,
  ToolRegistry,
  ToolsCalling,
  Usage,
} from '../types';

/**
 * Simplified Agent Runtime - The "Engine" that executes instructions from an "Agent" (Brain).
 * Now includes built-in call_llm support and allows full executor customization.
 */
export class AgentRuntime {
  private executors: Record<AgentInstruction['type'], InstructionExecutor>;

  constructor(
    private agent: Agent,
    private config: RuntimeConfig = {},
  ) {
    // Build executors with priority: agent.executors > config.executors > built-in
    this.executors = {
      call_llm: this.createCallLLMExecutor(),
      call_tool: this.createCallToolExecutor(),
      finish: this.createFinishExecutor(),
      request_human_approve: this.createHumanApproveExecutor(),
      request_human_prompt: this.createHumanPromptExecutor(),
      request_human_select: this.createHumanSelectExecutor(),
      // Config executors override built-in
      ...config.executors,
      // Agent provided executors have highest priority
      ...(agent.executors as any),
    };
  }

  /**
   * Executes a single step of the Plan -> Execute loop.
   * @param state - Current agent state
   * @param context - Runtime context for this step (required for proper phase detection)
   */
  async step(
    state: AgentState,
    context?: AgentRuntimeContext,
  ): Promise<{ events: AgentEvent[]; newState: AgentState; nextContext?: AgentRuntimeContext }> {
    try {
      // Increment step count and check limits
      const newState = structuredClone(state);
      newState.stepCount += 1;
      newState.lastModified = new Date().toISOString();

      // Check maximum steps limit
      if (newState.maxSteps && newState.stepCount > newState.maxSteps) {
        // Finish execution when maxSteps is exceeded
        newState.status = 'done';
        const finishEvent = {
          finalState: newState,
          reason: 'max_steps_exceeded' as const,
          reasonDetail: `Maximum steps exceeded: ${newState.maxSteps}`,
          type: 'done' as const,
        };

        return {
          events: [finishEvent],
          newState,
          nextContext: undefined, // No next context when done
        };
      }

      // Use provided context or create initial context
      const runtimeContext = context || this.createInitialContext(newState);

      // Get instructions from agent runner and normalize to array
      let rawInstructions: any;

      // Handle human approved tool calls
      if (runtimeContext.phase === 'human_approved_tool') {
        const approvedPayload = runtimeContext.payload as { approvedToolCall: ToolsCalling };
        rawInstructions = { payload: approvedPayload.approvedToolCall, type: 'call_tool' };
      } else {
        // Standard flow: Plan -> Execute
        rawInstructions = await this.agent.runner(runtimeContext, newState);
      }

      // Normalize to array
      const instructions = Array.isArray(rawInstructions) ? rawInstructions : [rawInstructions];

      // Execute all instructions sequentially
      let currentState = newState;
      const allEvents: AgentEvent[] = [];
      let finalNextContext: AgentRuntimeContext | undefined = undefined;

      for (const instruction of instructions) {
        let result;

        // Special handling for batch tool execution
        if (instruction.type === 'call_tools_batch') {
          result = await this.executeToolsBatch(instruction as any, currentState);
        } else {
          const executor = this.executors[instruction.type as keyof typeof this.executors];
          if (!executor) {
            throw new Error(`No executor found for instruction type: ${instruction.type}`);
          }
          result = await executor(instruction, currentState);
        }

        // Accumulate events
        allEvents.push(...result.events);

        // Update state
        currentState = result.newState;

        // Keep the last nextContext
        if (result.nextContext) {
          finalNextContext = result.nextContext;
        }

        // Stop execution if blocked
        if (currentState.status === 'waiting_for_human' || currentState.status === 'interrupted') {
          break;
        }
      }

      // Ensure stepCount and lastModified are preserved
      currentState.stepCount = newState.stepCount;
      currentState.lastModified = newState.lastModified;

      return {
        events: allEvents,
        newState: currentState,
        nextContext: finalNextContext,
      };
    } catch (error) {
      const errorState = structuredClone(state);
      errorState.stepCount += 1;
      errorState.lastModified = new Date().toISOString();
      return this.createErrorResult(errorState, error);
    }
  }

  /**
   * Convenience method for approving and executing a tool call
   */
  async approveToolCall(
    state: AgentState,
    approvedToolCall: any,
  ): Promise<{ events: AgentEvent[]; newState: AgentState; nextContext?: AgentRuntimeContext }> {
    const context: AgentRuntimeContext = {
      payload: { approvedToolCall },
      phase: 'human_approved_tool',
      session: this.createSessionContext(state),
    };

    return this.step(state, context);
  }

  /**
   * Interrupt the current execution
   * @param state - Current agent state
   * @param reason - Reason for interruption
   * @param canResume - Whether the interruption can be resumed later
   * @param metadata - Additional metadata about the interruption
   */
  interrupt(
    state: AgentState,
    reason: string,
    canResume: boolean = true,
    metadata?: Record<string, unknown>,
  ): { events: AgentEvent[]; newState: AgentState } {
    const newState = structuredClone(state);
    const interruptedAt = new Date().toISOString();

    newState.status = 'interrupted';
    newState.lastModified = interruptedAt;
    newState.interruption = {
      canResume,
      interruptedAt,
      // Store the current step for potential resumption
      interruptedInstruction: undefined,

      reason, // Could be enhanced to store current instruction
    };

    const interruptEvent: AgentEvent = {
      canResume,
      interruptedAt,
      metadata,
      reason,
      type: 'interrupted',
    };

    return {
      events: [interruptEvent],
      newState,
    };
  }

  /**
   * Resume execution from an interrupted state
   * @param state - Interrupted agent state
   * @param reason - Reason for resumption
   * @param context - Optional context to resume with
   */
  async resume(
    state: AgentState,
    reason: string = 'User resumed execution',
    context?: AgentRuntimeContext,
  ): Promise<{ events: AgentEvent[]; newState: AgentState; nextContext?: AgentRuntimeContext }> {
    if (state.status !== 'interrupted') {
      throw new Error('Cannot resume: state is not interrupted');
    }

    if (state.interruption && !state.interruption.canResume) {
      throw new Error('Cannot resume: interruption is not resumable');
    }

    const newState = structuredClone(state);
    const resumedAt = new Date().toISOString();
    const resumedFromStep = state.stepCount;

    // Clear interruption context and set status back to running
    newState.status = 'running';
    newState.lastModified = resumedAt;
    newState.interruption = undefined;

    const resumeEvent: AgentEvent = {
      reason,
      resumedAt,
      resumedFromStep,
      type: 'resumed',
    };

    // If context is provided, continue with that context
    if (context) {
      const result = await this.step(newState, context);
      return {
        events: [resumeEvent, ...result.events],
        newState: result.newState,
        nextContext: result.nextContext,
      };
    }

    // Otherwise, just return the resumed state
    return {
      events: [resumeEvent],
      newState,
      nextContext: this.createInitialContext(newState),
    };
  }

  /**
   * Create default usage statistics structure
   * @returns Default Usage object with all counters set to 0
   */
  static createDefaultUsage(): Usage {
    return {
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
    };
  }

  /**
   * Create default cost structure
   * @returns Default Cost object with all costs set to 0
   */
  static createDefaultCost(): Cost {
    const now = new Date().toISOString();
    return {
      calculatedAt: now,
      currency: 'USD',
      llm: {
        byModel: [],
        currency: 'USD',
        total: 0,
      },
      tools: {
        byTool: [],
        currency: 'USD',
        total: 0,
      },
      total: 0,
    };
  }

  /**
   * Create a new agent state with flexible initialization
   * @param partialState - Partial state to override defaults
   * @returns Complete AgentState with defaults filled in
   */
  static createInitialState(
    partialState?: Partial<AgentState> & { sessionId: string },
  ): AgentState {
    const now = new Date().toISOString();

    return {
      cost: AgentRuntime.createDefaultCost(),
      // Default values
      createdAt: now,
      lastModified: now,
      messages: [],
      status: 'idle',
      stepCount: 0,
      toolManifestMap: {},
      usage: AgentRuntime.createDefaultUsage(),
      // User provided values override defaults
      ...(partialState || { sessionId: '' }),
    };
  }

  // ============ Executor Factory Methods ============

  /** Create call_llm executor with streaming support */
  private createCallLLMExecutor(): InstructionExecutor {
    return async (instruction, state) => {
      const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
      const newState = structuredClone(state);
      const events: AgentEvent[] = [];

      newState.status = 'running';
      newState.lastModified = new Date().toISOString();

      events.push({ payload, type: 'llm_start' });

      // Use Agent's modelRuntime first, fallback to config
      const modelRuntime = this.agent.modelRuntime;
      if (!modelRuntime) {
        throw new Error(
          'Model Runtime is required for call_llm instruction. Provide it via Agent.modelRuntime or RuntimeConfig.modelRuntime',
        );
      }

      let assistantContent = '';
      let toolCalls: ToolsCalling[] = [];

      try {
        // Stream LLM response
        for await (const chunk of modelRuntime(payload)) {
          // Emit individual stream events for each chunk
          events.push({ chunk, type: 'llm_stream' });

          // Accumulate content and tool calls from chunks
          if (chunk.content) {
            assistantContent += chunk.content;
          }

          if (chunk.tool_calls) {
            toolCalls = chunk.tool_calls;
          }
        }

        events.push({
          result: { content: assistantContent, tool_calls: toolCalls },
          type: 'llm_result',
        });

        // Update usage and cost if agent provides calculation methods
        if (this.agent.calculateUsage) {
          newState.usage = this.agent.calculateUsage(
            'llm',
            { content: assistantContent, tool_calls: toolCalls },
            newState.usage,
          );
        }

        if (this.agent.calculateCost) {
          newState.cost = this.agent.calculateCost({
            costLimit: newState.costLimit,
            previousCost: newState.cost,
            usage: newState.usage,
          });
        }

        // Check cost limits
        if (newState.costLimit && newState.cost.total > newState.costLimit.maxTotalCost) {
          return this.handleCostLimitExceeded(newState);
        }

        // Provide next context based on LLM result
        const nextContext: AgentRuntimeContext = {
          payload: {
            hasToolCalls: toolCalls.length > 0,
            result: { content: assistantContent, tool_calls: toolCalls },
            toolCalls,
          },
          phase: 'llm_result',
          session: this.createSessionContext(newState),
        };

        return { events, newState, nextContext };
      } catch (error) {
        return this.createErrorResult(state, error);
      }
    };
  }

  /** Create call_tool executor */
  private createCallToolExecutor(): InstructionExecutor {
    return async (instruction, state) => {
      const { payload: toolCall } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
      const newState = structuredClone(state);
      const events: AgentEvent[] = [];

      newState.lastModified = new Date().toISOString();
      newState.status = 'running';

      const tools = this.agent.tools || ({} as ToolRegistry);

      // Support both ToolsCalling (OpenAI format) and CallingToolPayload formats
      const toolName = toolCall.apiName || toolCall.function?.name;
      const toolArgs = toolCall.arguments || toolCall.function?.arguments;
      const toolId = toolCall.id;

      const handler = tools[toolName];
      if (!handler) throw new Error(`Tool not found: ${toolName}`);

      const args = JSON.parse(toolArgs);
      const result = await handler(args);

      newState.messages.push({
        content: JSON.stringify(result),
        role: 'tool',
        tool_call_id: toolId,
      });

      events.push({ id: toolId, result, type: 'tool_result' });

      // Update usage and cost if agent provides calculation methods
      if (this.agent.calculateUsage) {
        newState.usage = this.agent.calculateUsage(
          'tool',
          { executionTime: 0, result, toolCall }, // Could track actual execution time
          newState.usage,
        );
      }

      if (this.agent.calculateCost) {
        newState.cost = this.agent.calculateCost({
          costLimit: newState.costLimit,
          previousCost: newState.cost,
          usage: newState.usage,
        });
      }

      // Check cost limits
      if (newState.costLimit && newState.cost.total > newState.costLimit.maxTotalCost) {
        return this.handleCostLimitExceeded(newState);
      }

      // Provide next context for tool result
      const nextContext: AgentRuntimeContext = {
        payload: {
          result,
          toolCall,
          toolCallId: toolCall.id,
        },
        phase: 'tool_result',
        session: this.createSessionContext(newState),
      };

      return { events, newState, nextContext };
    };
  }

  /** Create human approve executor */
  private createHumanApproveExecutor(): InstructionExecutor {
    return async (instruction, state) => {
      const { pendingToolsCalling } = instruction as Extract<
        AgentInstruction,
        { type: 'request_human_approve' }
      >;
      const newState = structuredClone(state);

      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_human';
      newState.pendingToolsCalling = pendingToolsCalling;

      const events: AgentEvent[] = [
        {
          pendingToolsCalling,
          sessionId: newState.sessionId,
          type: 'human_approve_required',
        },
        { toolCalls: pendingToolsCalling, type: 'tool_pending' },
      ];

      return { events, newState };
    };
  }

  /** Create human prompt executor */
  private createHumanPromptExecutor(): InstructionExecutor {
    return async (instruction, state) => {
      const { metadata, prompt } = instruction as Extract<
        AgentInstruction,
        { type: 'request_human_prompt' }
      >;
      const newState = structuredClone(state);

      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_human';
      newState.pendingHumanPrompt = { metadata, prompt };

      const events: AgentEvent[] = [
        {
          metadata,
          prompt,
          sessionId: newState.sessionId,
          type: 'human_prompt_required',
        },
      ];

      return { events, newState };
    };
  }

  /** Create human select executor */
  private createHumanSelectExecutor(): InstructionExecutor {
    return async (instruction, state) => {
      const { metadata, multi, options, prompt } = instruction as Extract<
        AgentInstruction,
        { type: 'request_human_select' }
      >;
      const newState = structuredClone(state);

      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_human';
      newState.pendingHumanSelect = { metadata, multi, options, prompt };

      const events: AgentEvent[] = [
        {
          metadata,
          multi,
          options,
          prompt,
          sessionId: newState.sessionId,
          type: 'human_select_required',
        },
      ];

      return { events, newState };
    };
  }

  /** Create finish executor */
  private createFinishExecutor(): InstructionExecutor {
    return async (instruction, state) => {
      const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
      const newState = structuredClone(state);

      newState.lastModified = new Date().toISOString();
      newState.status = 'done';

      const events: AgentEvent[] = [
        {
          finalState: newState,
          reason,
          reasonDetail,
          type: 'done',
        },
      ];
      return { events, newState };
    };
  }

  // ============ Helper Methods ============

  /**
   * Execute multiple tool calls concurrently
   */
  private async executeToolsBatch(
    instruction: { payload: any[]; type: 'call_tools_batch' },
    baseState: AgentState,
  ): Promise<{
    events: AgentEvent[];
    newState: AgentState;
    nextContext?: AgentRuntimeContext;
  }> {
    const { payload: toolsCalling } = instruction;

    // Execute all tools concurrently based on the same state
    const results = await Promise.all(
      toolsCalling.map((toolCall) =>
        this.executors.call_tool(
          { payload: toolCall, type: 'call_tool' } as any,
          structuredClone(baseState), // Each tool starts from the same base state
        ),
      ),
    );

    // Merge results
    return this.mergeToolResults(results, baseState);
  }

  /**
   * Merge multiple tool execution results
   */
  private mergeToolResults(
    results: Array<{
      events: AgentEvent[];
      newState: AgentState;
      nextContext?: AgentRuntimeContext;
    }>,
    baseState: AgentState,
  ): {
    events: AgentEvent[];
    newState: AgentState;
    nextContext?: AgentRuntimeContext;
  } {
    const newState = structuredClone(baseState);
    const allEvents: AgentEvent[] = [];

    // Merge all tool messages in order
    for (const result of results) {
      // Extract tool role messages
      const toolMessages = result.newState.messages.filter((m) => m.role === 'tool');
      newState.messages.push(...toolMessages);

      // Merge events
      allEvents.push(...result.events);

      // Merge usage statistics (if available)
      if (result.newState.usage && newState.usage) {
        newState.usage.tools.totalCalls += result.newState.usage.tools.totalCalls;
        newState.usage.tools.totalTimeMs += result.newState.usage.tools.totalTimeMs;

        // Merge per-tool statistics (now using array)
        result.newState.usage.tools.byTool.forEach((toolStats) => {
          const existingTool = newState.usage.tools.byTool.find((t) => t.name === toolStats.name);
          if (existingTool) {
            existingTool.calls += toolStats.calls;
            existingTool.totalTimeMs += toolStats.totalTimeMs;
            existingTool.errors += toolStats.errors || 0;
          } else {
            newState.usage.tools.byTool.push({ ...toolStats });
          }
        });
      }

      // Merge cost statistics (if available)
      if (result.newState.cost && newState.cost) {
        newState.cost.tools.total += result.newState.cost.tools.total;
        newState.cost.total += result.newState.cost.tools.total;

        // Merge per-tool cost statistics (now using array)
        result.newState.cost.tools.byTool.forEach((toolCost) => {
          const existingToolCost = newState.cost.tools.byTool.find((t) => t.name === toolCost.name);
          if (existingToolCost) {
            existingToolCost.calls += toolCost.calls;
            existingToolCost.totalCost += toolCost.totalCost;
          } else {
            newState.cost.tools.byTool.push({ ...toolCost });
          }
        });
      }
    }

    newState.lastModified = new Date().toISOString();

    return {
      events: allEvents,
      newState,
      nextContext: {
        payload: {
          toolCount: results.length,
          toolResults: results.map((r) => r.nextContext?.payload),
        },
        phase: 'tools_batch_result',
        session: this.createSessionContext(newState),
      },
    };
  }

  /**
   * Handle cost limit exceeded scenario
   */
  private handleCostLimitExceeded(state: AgentState): {
    events: AgentEvent[];
    newState: AgentState;
    nextContext?: AgentRuntimeContext;
  } {
    const newState = structuredClone(state);
    const costLimit = newState.costLimit!;

    switch (costLimit.onExceeded) {
      case 'stop': {
        newState.status = 'done';
        const finishEvent = {
          finalState: newState,
          reason: 'cost_limit_exceeded' as const,
          reasonDetail: `Cost limit exceeded: ${newState.cost.total} ${newState.cost.currency} > ${costLimit.maxTotalCost} ${costLimit.currency}`,
          type: 'done' as const,
        };
        return {
          events: [finishEvent],
          newState,
          nextContext: undefined,
        };
      }

      case 'interrupt': {
        return {
          ...this.interrupt(
            newState,
            `Cost limit exceeded: ${newState.cost.total} ${newState.cost.currency}`,
            true,
            {
              costExceeded: true,
              currentCost: newState.cost.total,
              limitCost: costLimit.maxTotalCost,
            },
          ),
          nextContext: undefined,
        };
      }

      default: {
        // Continue execution but emit warning event
        const warningEvent = {
          error: new Error(
            `Warning: Cost limit exceeded: ${newState.cost.total} ${newState.cost.currency}`,
          ),
          type: 'error' as const,
        };
        return {
          events: [warningEvent],
          newState,
          nextContext: {
            payload: { error: warningEvent.error, isCostWarning: true },
            phase: 'error' as const,
            session: this.createSessionContext(newState),
          },
        };
      }
    }
  }

  /**
   * Create session context metadata - reusable helper
   */
  private createSessionContext(state: AgentState) {
    return {
      messageCount: state.messages.length,
      sessionId: state.sessionId,
      status: state.status,
      stepCount: state.stepCount,
    };
  }

  /**
   * Create initial context for the first step (fallback for backward compatibility)
   */
  private createInitialContext(state: AgentState): AgentRuntimeContext {
    const lastMessage = state.messages.at(-1);

    if (lastMessage?.role === 'user') {
      return {
        payload: {
          isFirstMessage: state.messages.length === 1,
          message: lastMessage,
        },
        phase: 'user_input',
        session: this.createSessionContext(state),
      };
    }

    return {
      payload: undefined,
      phase: 'init',
      session: this.createSessionContext(state),
    };
  }

  /** Create error state and events */
  private createErrorResult(
    state: AgentState,
    error: any,
  ): { events: AgentEvent[]; newState: AgentState } {
    const errorState = structuredClone(state);
    errorState.status = 'error';
    errorState.error = error;
    errorState.lastModified = new Date().toISOString();

    const errorEvent = { error, type: 'error' } as const;

    return {
      events: [errorEvent],
      newState: errorState,
    };
  }
}
