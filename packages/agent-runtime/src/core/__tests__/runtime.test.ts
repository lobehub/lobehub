import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  AgentEventError,
  AgentRuntimeContext,
  AgentState,
  Cost,
  CostCalculationContext,
  CostLimit,
  RuntimeConfig,
  ToolsCalling,
  Usage,
} from '../../types';
import { AgentRuntime } from '../runtime';

// Mock Agent for testing
class MockAgent implements Agent {
  tools = {};
  executors = {};
  modelRuntime?: (payload: unknown) => AsyncIterable<any>;

  async runner(context: AgentRuntimeContext, state: AgentState) {
    switch (context.phase) {
      case 'user_input':
        return { type: 'call_llm' as const, payload: { messages: state.messages } };
      case 'llm_result':
        const llmPayload = context.payload as { result: any; hasToolCalls: boolean };
        if (llmPayload.hasToolCalls) {
          return {
            type: 'request_human_approve' as const,
            pendingToolsCalling: llmPayload.result.tool_calls,
          };
        }
        return { type: 'finish' as const, reason: 'completed' as const, reasonDetail: 'Done' };
      case 'tool_result':
        return { type: 'call_llm' as const, payload: { messages: state.messages } };
      default:
        return { type: 'finish' as const, reason: 'completed' as const, reasonDetail: 'Done' };
    }
  }
}

// Helper function to create test context
function createTestContext(
  phase: AgentRuntimeContext['phase'],
  payload?: any,
  sessionId: string = 'test-session',
): AgentRuntimeContext {
  return {
    phase,
    payload,
    session: {
      sessionId,
      messageCount: 1,
      status: 'idle',
      stepCount: 0,
    },
  };
}

describe('AgentRuntime', () => {
  describe('Constructor and Executor Priority', () => {
    it('should use built-in executors by default', () => {
      const agent = new MockAgent();
      const runtime = new AgentRuntime(agent);

      // @ts-expect-error - accessing private property for testing
      const executors = runtime.executors;

      expect(executors).toHaveProperty('call_llm');
      expect(executors).toHaveProperty('call_tool');
      expect(executors).toHaveProperty('finish');
      expect(executors).toHaveProperty('request_human_approve');
    });

    it('should allow config executors to override built-in ones', () => {
      const agent = new MockAgent();
      const customFinish = vi.fn();

      const config: RuntimeConfig = {
        executors: {
          finish: customFinish,
        },
      };

      const runtime = new AgentRuntime(agent, config);

      // @ts-ignore
      expect(runtime.executors.finish).toBe(customFinish);
    });

    it('should give agent executors highest priority', () => {
      const agent = new MockAgent();
      const agentFinish = vi.fn();
      const configFinish = vi.fn();

      agent.executors = { finish: agentFinish };
      const config: RuntimeConfig = {
        executors: { finish: configFinish },
      };

      const runtime = new AgentRuntime(agent, config);

      // @ts-ignore
      expect(runtime.executors.finish).toBe(agentFinish);
    });
  });

  describe('step method', () => {
    it('should execute approved tool call directly', async () => {
      const agent = new MockAgent();
      agent.tools = {
        test_tool: vi.fn().mockResolvedValue({ result: 'success' }),
      };

      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

      const toolCall: ToolsCalling = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: '{"input": "test"}',
        },
      };

      const result = await runtime.approveToolCall(state, toolCall);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'tool_result',
        id: 'call_123',
        result: { result: 'success' },
      });
      expect(result.newState.messages).toHaveLength(1);
      expect(result.newState.messages[0].role).toBe('tool');
    });

    it('should follow agent runner -> executor flow', async () => {
      const agent = new MockAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const result = await runtime.step(state);

      // Should call agent runner, get call_llm instruction, but fail due to no llmProvider
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('error');
      expect(result.newState.status).toBe('error');
    });

    it('should handle errors gracefully', async () => {
      const agent = new MockAgent();
      agent.runner = vi.fn().mockImplementation(() => Promise.reject(new Error('Agent error')));

      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

      const result = await runtime.step(state);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'error',
        error: expect.any(Error),
      });
      expect(result.newState.status).toBe('error');
      expect(result.newState.error).toBeInstanceOf(Error);
    });
  });

  describe('Built-in Executors', () => {
    describe('call_llm executor', () => {
      it('should require modelRuntime', async () => {
        const agent = new MockAgent();
        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({
          sessionId: 'test-session',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const result = await runtime.step(state);

        expect(result.events[0].type).toBe('error');
        expect((result.events[0] as AgentEventError).error.message).toContain(
          'Model Runtime is required',
        );
      });

      it('should handle streaming LLM response', async () => {
        const agent = new MockAgent();

        async function* mockModelRuntime(payload: unknown) {
          yield { content: 'Hello' };
          yield { content: ' world' };
          yield { content: '!' };
        }

        agent.modelRuntime = mockModelRuntime;

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({
          sessionId: 'test-session',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const result = await runtime.step(state);

        expect(result.events).toHaveLength(5); // start + 3 streams + result
        expect(result.events[0]).toMatchObject({
          type: 'llm_start',
          payload: expect.anything(),
        });

        expect(result.events[1]).toMatchObject({
          type: 'llm_stream',
          chunk: { content: 'Hello' },
        });

        expect(result.events[4]).toMatchObject({
          type: 'llm_result',
          result: { content: 'Hello world!', tool_calls: [] },
        });

        // In the new architecture, call_llm executor doesn't add messages to state
        // It only returns events, messages should be handled by higher-level logic
        expect(result.newState.messages).toHaveLength(1); // Only user message
        expect(result.newState.status).toBe('running');
      });

      it('should handle LLM response with tool calls', async () => {
        const agent = new MockAgent();

        async function* mockModelRuntime(payload: unknown) {
          yield { content: 'I need to use a tool' };
          yield {
            tool_calls: [
              {
                id: 'call_123',
                type: 'function' as const,
                function: { name: 'test_tool', arguments: '{}' },
              },
            ],
          };
        }

        agent.modelRuntime = mockModelRuntime;

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({
          sessionId: 'test-session',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const result = await runtime.step(state);

        // In the new architecture, call_llm executor doesn't add messages to state
        // Check that the events contain the expected LLM result
        expect(result.events).toContainEqual(
          expect.objectContaining({
            type: 'llm_result',
            result: expect.objectContaining({
              content: 'I need to use a tool',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: { name: 'test_tool', arguments: '{}' },
                },
              ],
            }),
          }),
        );
      });
    });

    describe('call_tool executor', () => {
      it('should execute tool and add result to messages', async () => {
        const agent = new MockAgent();
        agent.tools = {
          calculator: vi.fn().mockResolvedValue({ result: 42 }),
        };

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

        const toolCall: ToolsCalling = {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: '{"expression": "2+2"}',
          },
        };

        const result = await runtime.approveToolCall(state, toolCall);

        expect((agent.tools as any).calculator).toHaveBeenCalledWith({ expression: '2+2' });
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
          type: 'tool_result',
          id: 'call_123',
          result: { result: 42 },
        });

        expect(result.newState.messages).toHaveLength(1);
        expect(result.newState.messages[0]).toMatchObject({
          role: 'tool',
          tool_call_id: 'call_123',
          content: '{"result":42}',
        });
      });

      it('should throw error for unknown tool', async () => {
        const agent = new MockAgent();
        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

        const toolCall: ToolsCalling = {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'unknown_tool',
            arguments: '{}',
          },
        };

        const result = await runtime.approveToolCall(state, toolCall);

        expect(result.events[0].type).toBe('error');
        expect((result.events[0] as AgentEventError).error.message).toContain(
          'Tool not found: unknown_tool',
        );
      });
    });

    describe('human interaction executors', () => {
      it('should handle human approve request', async () => {
        const agent = new MockAgent();
        // Mock agent to return human approve instruction
        agent.runner = vi.fn().mockImplementation(() =>
          Promise.resolve({
            type: 'request_human_approve',
            pendingToolsCalling: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'test_tool', arguments: '{}' },
              },
            ],
          }),
        );

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

        const result = await runtime.step(state);

        expect(result.events).toHaveLength(2);
        expect(result.events[0]).toMatchObject({
          type: 'human_approve_required',
          sessionId: 'test-session',
        });
        expect(result.events[1]).toMatchObject({
          type: 'tool_pending',
        });

        expect(result.newState.status).toBe('waiting_for_human');
        expect(result.newState.pendingToolsCalling).toBeDefined();
      });

      it('should handle human prompt request', async () => {
        const agent = new MockAgent();
        agent.runner = vi.fn().mockImplementation(() =>
          Promise.resolve({
            type: 'request_human_prompt',
            prompt: 'Please provide input',
            metadata: { key: 'value' },
          }),
        );

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

        const result = await runtime.step(state);

        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
          type: 'human_prompt_required',
          prompt: 'Please provide input',
          metadata: { key: 'value' },
          sessionId: 'test-session',
        });

        expect(result.newState.status).toBe('waiting_for_human');
        expect(result.newState.pendingHumanPrompt).toEqual({
          prompt: 'Please provide input',
          metadata: { key: 'value' },
        });
      });

      it('should handle human select request', async () => {
        const agent = new MockAgent();
        agent.runner = vi.fn().mockImplementation(() =>
          Promise.resolve({
            type: 'request_human_select',
            prompt: 'Choose an option',
            options: [
              { label: 'Option 1', value: 'opt1' },
              { label: 'Option 2', value: 'opt2' },
            ],
            multi: false,
          }),
        );

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

        const result = await runtime.step(state);

        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
          type: 'human_select_required',
          prompt: 'Choose an option',
          options: [
            { label: 'Option 1', value: 'opt1' },
            { label: 'Option 2', value: 'opt2' },
          ],
          multi: false,
          sessionId: 'test-session',
        });

        expect(result.newState.status).toBe('waiting_for_human');
      });
    });

    describe('finish executor', () => {
      it('should mark conversation as done', async () => {
        const agent = new MockAgent();
        agent.runner = vi.fn().mockImplementation(() =>
          Promise.resolve({
            type: 'finish',
            reason: 'completed',
            reasonDetail: 'Task completed',
          }),
        );

        const runtime = new AgentRuntime(agent);
        const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

        const result = await runtime.step(state);

        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
          type: 'done',
          finalState: expect.objectContaining({
            status: 'done',
          }),
          reason: 'completed',
          reasonDetail: 'Task completed',
        });

        expect(result.newState.status).toBe('done');
      });
    });
  });

  describe('createInitialState', () => {
    it('should create initial state without message', () => {
      const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

      expect(state).toMatchObject({
        sessionId: 'test-session',
        status: 'idle',
        messages: [],
        stepCount: 0,
        createdAt: expect.any(String),
        lastModified: expect.any(String),
      });
    });

    it('should create initial state with message', () => {
      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: 'Hello world' }],
      });

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello world',
      });
      expect(state.stepCount).toBe(0);
    });

    it('should create initial state with custom stepCount', () => {
      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        stepCount: 5,
      });

      expect(state.stepCount).toBe(5);
    });

    it('should create initial state with maxSteps limit', () => {
      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        maxSteps: 10,
      });

      expect(state.maxSteps).toBe(10);
      expect(state.stepCount).toBe(0);
    });
  });

  describe('Step Count Tracking', () => {
    it('should increment stepCount on each step execution', async () => {
      const agent = new MockAgent();
      const runtime = new AgentRuntime(agent);

      let state = AgentRuntime.createInitialState({ sessionId: 'test-session' });
      expect(state.stepCount).toBe(0);

      // First step
      const result1 = await runtime.step(state, createTestContext('user_input'));
      expect(result1.newState.stepCount).toBe(1);

      // Second step
      const result2 = await runtime.step(result1.newState, createTestContext('user_input'));
      expect(result2.newState.stepCount).toBe(2);
    });

    it('should respect maxSteps limit', async () => {
      const agent = new MockAgent();
      // Add a mock modelRuntime to avoid LLM provider error
      agent.modelRuntime = async function* () {
        yield { content: 'test response' };
      };
      const runtime = new AgentRuntime(agent);

      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        maxSteps: 3, // 允许 3 步
      });

      // First step - should work
      const result1 = await runtime.step(state, createTestContext('user_input'));
      expect(result1.newState.stepCount).toBe(1);
      expect(result1.newState.status).not.toBe('error');

      // Second step - should work
      const result2 = await runtime.step(result1.newState, createTestContext('user_input'));
      expect(result2.newState.stepCount).toBe(2);
      expect(result2.newState.status).not.toBe('error');

      // Third step - should work (at limit)
      const result3 = await runtime.step(result2.newState, createTestContext('user_input'));
      expect(result3.newState.stepCount).toBe(3);
      expect(result3.newState.status).not.toBe('error');

      // Fourth step - should finish due to maxSteps
      const result4 = await runtime.step(result3.newState, createTestContext('user_input'));
      expect(result4.newState.stepCount).toBe(4);
      expect(result4.newState.status).toBe('done');
      expect(result4.events[0]).toMatchObject({
        type: 'done',
        finalState: expect.objectContaining({
          status: 'done',
        }),
        reason: 'max_steps_exceeded',
        reasonDetail: 'Maximum steps exceeded: 3',
      });
    });

    it('should include stepCount in session context', async () => {
      const agent = new MockAgent();
      // Mock agent to check the context it receives
      const runnerSpy = vi.spyOn(agent, 'runner');

      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        stepCount: 5, // Start with step 5
        messages: [{ role: 'user', content: 'test' }],
      });

      // Don't provide context, let runtime create it with updated stepCount
      await runtime.step(state);

      // Check that agent received correct stepCount in context
      expect(runnerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            stepCount: 6, // Should be incremented
          }),
        }),
        expect.any(Object),
      );
    });
  });

  describe('Interruption Handling', () => {
    it('should interrupt execution with reason and metadata', () => {
      const agent = new MockAgent();
      const runtime = new AgentRuntime(agent);

      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        stepCount: 3,
      });

      const result = runtime.interrupt(state, 'User requested stop', true, {
        userAction: 'stop_button',
      });

      expect(result.newState.status).toBe('interrupted');
      expect(result.newState.interruption).toMatchObject({
        reason: 'User requested stop',
        canResume: true,
        interruptedAt: expect.any(String),
      });

      expect(result.events[0]).toMatchObject({
        type: 'interrupted',
        reason: 'User requested stop',
        canResume: true,
        metadata: { userAction: 'stop_button' },
        interruptedAt: expect.any(String),
      });
    });

    it('should resume from interrupted state', async () => {
      const agent = new MockAgent();
      agent.modelRuntime = async function* () {
        yield { content: 'resumed response' };
      };
      const runtime = new AgentRuntime(agent);

      // Create interrupted state
      let state = AgentRuntime.createInitialState({ sessionId: 'test-session' });
      const interruptResult = runtime.interrupt(state, 'Test interruption');

      // Resume execution
      const resumeResult = await runtime.resume(interruptResult.newState, 'Test resume');

      expect(resumeResult.newState.status).toBe('running');
      expect(resumeResult.newState.interruption).toBeUndefined();

      expect(resumeResult.events[0]).toMatchObject({
        type: 'resumed',
        reason: 'Test resume',
        resumedFromStep: 0,
        resumedAt: expect.any(String),
      });
    });

    it('should not allow resume if canResume is false', async () => {
      const agent = new MockAgent();
      const runtime = new AgentRuntime(agent);

      let state = AgentRuntime.createInitialState({ sessionId: 'test-session' });
      const interruptResult = runtime.interrupt(state, 'Fatal error', false);

      await expect(runtime.resume(interruptResult.newState)).rejects.toThrow(
        'Cannot resume: interruption is not resumable',
      );
    });

    it('should not allow resume from non-interrupted state', async () => {
      const agent = new MockAgent();
      const runtime = new AgentRuntime(agent);

      const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

      await expect(runtime.resume(state)).rejects.toThrow(
        'Cannot resume: state is not interrupted',
      );
    });

    it('should resume with specific context', async () => {
      const agent = new MockAgent();
      agent.modelRuntime = async function* () {
        yield { content: 'context-specific response' };
      };
      const runtime = new AgentRuntime(agent);

      let state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      const interruptResult = runtime.interrupt(state, 'Test interruption');

      const resumeContext: AgentRuntimeContext = {
        phase: 'user_input',
        payload: { message: { role: 'user', content: 'Hello' } },
        session: {
          sessionId: 'test-session',
          messageCount: 1,
          status: 'interrupted',
          stepCount: 0,
        },
      };

      const resumeResult = await runtime.resume(
        interruptResult.newState,
        'Resume with context',
        resumeContext,
      );

      expect(resumeResult.events.length).toBeGreaterThanOrEqual(2); // resume + llm events (start, stream, result)
      expect(resumeResult.events[0].type).toBe('resumed');
      expect(resumeResult.newState.status).toBe('running');

      // Should contain LLM execution events
      expect(resumeResult.events.map((e) => e.type)).toContain('llm_start');
      expect(resumeResult.events.map((e) => e.type)).toContain('llm_result');
    });
  });

  describe('Usage and Cost Tracking', () => {
    it('should initialize with zero usage and cost', () => {
      const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

      expect(state.usage).toMatchObject({
        llm: {
          tokens: { input: 0, output: 0, total: 0 },
          apiCalls: 0,
          processingTimeMs: 0,
        },
        tools: {
          totalCalls: 0,
          byTool: [],
          totalTimeMs: 0,
        },
        humanInteraction: {
          approvalRequests: 0,
          promptRequests: 0,
          selectRequests: 0,
          totalWaitingTimeMs: 0,
        },
      });

      expect(state.cost).toMatchObject({
        llm: {
          byModel: [],
          total: 0,
          currency: 'USD',
        },
        tools: {
          byTool: [],
          total: 0,
          currency: 'USD',
        },
        total: 0,
        currency: 'USD',
        calculatedAt: expect.any(String),
      });
    });

    it('should track usage and cost through agent methods', async () => {
      // Create agent with cost calculation methods
      class CostTrackingAgent implements Agent {
        tools = {
          test_tool: async () => ({ result: 'success' }),
        };

        async runner(context: AgentRuntimeContext, state: AgentState) {
          switch (context.phase) {
            case 'user_input':
              return { type: 'call_llm' as const, payload: { messages: state.messages } };
            default:
              return {
                type: 'finish' as const,
                reason: 'completed' as const,
                reasonDetail: 'Done',
              };
          }
        }

        calculateUsage(
          operationType: 'llm' | 'tool' | 'human_interaction',
          operationResult: any,
          previousUsage: Usage,
        ): Usage {
          const newUsage = structuredClone(previousUsage);

          if (operationType === 'llm') {
            newUsage.llm.tokens.input += 100;
            newUsage.llm.tokens.output += 50;
            newUsage.llm.tokens.total += 150;
            newUsage.llm.apiCalls += 1;
            newUsage.llm.processingTimeMs += 1000;
          }

          return newUsage;
        }

        calculateCost(context: CostCalculationContext): Cost {
          const newCost = structuredClone(context.previousCost || (context.usage as any));

          // Simple cost calculation: $0.01 per 1000 tokens
          const tokenCost = (context.usage.llm.tokens.total / 1000) * 0.01;
          newCost.llm.total = tokenCost;
          newCost.total = tokenCost;
          newCost.calculatedAt = new Date().toISOString();

          return newCost;
        }
        modelRuntime = async function* () {
          yield { content: 'test response' };
        };
      }

      const agent = new CostTrackingAgent();
      const runtime = new AgentRuntime(agent);

      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const result = await runtime.step(state, createTestContext('user_input'));

      // Should have updated usage
      expect(result.newState.usage.llm.tokens.total).toBe(150);
      expect(result.newState.usage.llm.apiCalls).toBe(1);

      // Should have calculated cost
      expect(result.newState.cost.total).toBe(0.0015); // 150 tokens * $0.01/1000
    });

    it('should respect cost limits with stop action', async () => {
      class CostTrackingAgent implements Agent {
        async runner(context: AgentRuntimeContext, state: AgentState) {
          return { type: 'call_llm' as const, payload: { messages: state.messages } };
        }

        calculateUsage(operationType: string, operationResult: any, previousUsage: Usage): Usage {
          const newUsage = structuredClone(previousUsage);
          newUsage.llm.tokens.total += 1000; // High token usage
          return newUsage;
        }

        calculateCost(context: CostCalculationContext): Cost {
          const newCost = structuredClone(context.previousCost || ({} as Cost));
          newCost.total = 10.0; // High cost that exceeds limit
          newCost.currency = 'USD';
          newCost.calculatedAt = new Date().toISOString();
          return newCost;
        }
        modelRuntime = async function* () {
          yield { content: 'test response' };
        };
      }

      const agent = new CostTrackingAgent();
      const runtime = new AgentRuntime(agent);

      const costLimit: CostLimit = {
        maxTotalCost: 5.0,
        currency: 'USD',
        onExceeded: 'stop',
      };

      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: 'Hello' }],
        costLimit,
      });

      const result = await runtime.step(state, createTestContext('user_input'));

      expect(result.newState.status).toBe('done');
      expect(result.events[0]).toMatchObject({
        type: 'done',
        reason: 'cost_limit_exceeded',
        reasonDetail: expect.stringContaining('Cost limit exceeded'),
      });
    });

    it('should handle cost limit with interrupt action', async () => {
      class CostTrackingAgent implements Agent {
        async runner(context: AgentRuntimeContext, state: AgentState) {
          return { type: 'call_llm' as const, payload: { messages: state.messages } };
        }

        calculateCost(context: CostCalculationContext): Cost {
          return {
            llm: { byModel: [], total: 15.0, currency: 'USD' },
            tools: { byTool: [], total: 0, currency: 'USD' },
            total: 15.0,
            currency: 'USD',
            calculatedAt: new Date().toISOString(),
          };
        }
        modelRuntime = async function* () {
          yield { content: 'test response' };
        };
      }

      const agent = new CostTrackingAgent();
      const runtime = new AgentRuntime(agent);

      const costLimit: CostLimit = {
        maxTotalCost: 10.0,
        currency: 'USD',
        onExceeded: 'interrupt',
      };

      const state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: 'Hello' }],
        costLimit,
      });

      const result = await runtime.step(state, createTestContext('user_input'));

      expect(result.newState.status).toBe('interrupted');
      expect(result.events[0]).toMatchObject({
        type: 'interrupted',
        reason: expect.stringContaining('Cost limit exceeded'),
        metadata: expect.objectContaining({
          costExceeded: true,
        }),
      });
    });
  });

  describe('Integration Tests', () => {
    it('should complete a full conversation flow', async () => {
      const agent = new MockAgent();
      agent.tools = {
        get_weather: vi.fn().mockResolvedValue({
          temperature: 25,
          condition: 'sunny',
        }),
      };

      // Mock agent behavior for different states
      agent.runner = vi
        .fn()
        .mockImplementation((context: AgentRuntimeContext, state: AgentState) => {
          switch (context.phase) {
            case 'user_input':
              return Promise.resolve({ type: 'call_llm', payload: { messages: state.messages } });
            case 'llm_result':
              const llmPayload = context.payload as { result: any; hasToolCalls: boolean };
              if (llmPayload.hasToolCalls) {
                return Promise.resolve({
                  type: 'request_human_approve',
                  pendingToolsCalling: llmPayload.result.tool_calls,
                });
              }
              return Promise.resolve({ type: 'finish', reason: 'completed', reasonDetail: 'Done' });
            case 'tool_result':
              return Promise.resolve({ type: 'call_llm', payload: { messages: state.messages } });
            default:
              return Promise.resolve({ type: 'finish', reason: 'completed', reasonDetail: 'Done' });
          }
        });

      async function* mockModelRuntime(payload: unknown) {
        const messages = (payload as any).messages;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'user') {
          yield { content: "I'll check the weather for you." };
          yield {
            tool_calls: [
              {
                id: 'call_weather',
                type: 'function' as const,
                function: {
                  name: 'get_weather',
                  arguments: '{"city": "Beijing"}',
                },
              },
            ],
          };
        } else if (lastMessage.role === 'tool') {
          yield { content: 'The weather in Beijing is 25°C and sunny.' };
        }
      }

      agent.modelRuntime = mockModelRuntime;
      const runtime = new AgentRuntime(agent);

      // Step 1: User asks question
      let state = AgentRuntime.createInitialState({
        sessionId: 'test-session',
        messages: [{ role: 'user', content: "What's the weather in Beijing?" }],
      });
      let result = await runtime.step(state);

      // Should get LLM response with tool call (status is 'running' after LLM execution)
      expect(result.newState.status).toBe('running');
      // In new architecture, call_llm doesn't add messages to state
      expect(result.newState.messages).toHaveLength(1); // Only user message
      // Check events contain the tool call result
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'llm_result',
          result: expect.objectContaining({
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                id: 'call_weather',
                type: 'function',
              }),
            ]),
          }),
        }),
      );

      // Step 1.5: Agent processes assistant message with tool calls using nextContext
      result = await runtime.step(result.newState, result.nextContext);

      // Now should request human approval
      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.newState.pendingToolsCalling).toHaveLength(1);

      // Step 2: Approve and execute tool call
      const toolCall = result.newState.pendingToolsCalling![0];
      result = await runtime.approveToolCall(result.newState, toolCall);

      // Should have executed tool
      expect((agent.tools as any).get_weather).toHaveBeenCalledWith({ city: 'Beijing' });
      expect(result.newState.messages).toHaveLength(2); // user + tool result (call_tool executor adds tool message)

      // Step 3: LLM processes tool result using nextContext
      result = await runtime.step(result.newState, result.nextContext);

      // Should get final response in events
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'llm_result',
          result: expect.objectContaining({
            content: expect.stringContaining('25°C and sunny'),
          }),
        }),
      );
    });
  });

  describe('Batch Tool Execution', () => {
    it('should execute multiple tools concurrently with call_tools_batch instruction', async () => {
      // Agent that returns multiple tool calls
      class BatchToolAgent implements Agent {
        tools = {
          tool_a: vi.fn().mockResolvedValue({ result: 'result_a' }),
          tool_b: vi.fn().mockResolvedValue({ result: 'result_b' }),
          tool_c: vi.fn().mockResolvedValue({ result: 'result_c' }),
        };

        async runner(context: AgentRuntimeContext, _state: AgentState) {
          if (context.phase === 'user_input') {
            return {
              payload: [
                {
                  id: 'call_a',
                  type: 'function' as const,
                  function: { name: 'tool_a', arguments: '{}' },
                },
                {
                  id: 'call_b',
                  type: 'function' as const,
                  function: { name: 'tool_b', arguments: '{}' },
                },
                {
                  id: 'call_c',
                  type: 'function' as const,
                  function: { name: 'tool_c', arguments: '{}' },
                },
              ],
              type: 'call_tools_batch' as const,
            };
          }
          return { type: 'finish' as const, reason: 'completed' as const };
        }
      }

      const agent = new BatchToolAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        sessionId: 'batch-test',
        messages: [{ role: 'user', content: 'Execute tools' }],
      });

      const result = await runtime.step(state);

      // Should have executed all 3 tools
      expect(agent.tools.tool_a).toHaveBeenCalled();
      expect(agent.tools.tool_b).toHaveBeenCalled();
      expect(agent.tools.tool_c).toHaveBeenCalled();

      // Should have 3 tool result events
      expect(result.events.filter((e) => e.type === 'tool_result')).toHaveLength(3);

      // Should have 3 tool messages in state
      const toolMessages = result.newState.messages.filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(3);

      // Should have tools_batch_result phase in nextContext
      expect(result.nextContext?.phase).toBe('tools_batch_result');
      expect(result.nextContext?.payload).toHaveProperty('toolCount', 3);
    });

    it('should support agent returning instruction array', async () => {
      // Agent that returns array of instructions
      class ArrayReturnAgent implements Agent {
        tools = {
          tool_1: vi.fn().mockResolvedValue({ result: 'tool_1_result' }),
          tool_2: vi.fn().mockResolvedValue({ result: 'tool_2_result' }),
        };

        async runner(context: AgentRuntimeContext, _state: AgentState) {
          if (context.phase === 'user_input') {
            // Return array of instructions
            return [
              {
                payload: {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'tool_1', arguments: '{}' },
                },
                type: 'call_tool' as const,
              },
              {
                payload: {
                  id: 'call_2',
                  type: 'function' as const,
                  function: { name: 'tool_2', arguments: '{}' },
                },
                type: 'call_tool' as const,
              },
            ];
          }
          return { type: 'finish' as const, reason: 'completed' as const };
        }
      }

      const agent = new ArrayReturnAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        sessionId: 'array-test',
        messages: [{ role: 'user', content: 'Execute tools' }],
      });

      const result = await runtime.step(state);

      // Should have executed both tools sequentially
      expect(agent.tools.tool_1).toHaveBeenCalled();
      expect(agent.tools.tool_2).toHaveBeenCalled();

      // Should have 2 tool result events
      expect(result.events.filter((e) => e.type === 'tool_result')).toHaveLength(2);

      // Should have 2 tool messages in state
      const toolMessages = result.newState.messages.filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(2);
    });

    it('should stop execution when encountering blocking status', async () => {
      // Agent that returns mixed instructions with approval
      class BlockingAgent implements Agent {
        tools = {
          safe_tool: vi.fn().mockResolvedValue({ result: 'safe_result' }),
        };

        async runner(context: AgentRuntimeContext, _state: AgentState) {
          if (context.phase === 'user_input') {
            // Return array: safe tool + approval request
            return [
              {
                payload: {
                  id: 'call_safe',
                  type: 'function' as const,
                  function: { name: 'safe_tool', arguments: '{}' },
                },
                type: 'call_tool' as const,
              },
              {
                pendingToolsCalling: [
                  {
                    id: 'call_danger',
                    type: 'function' as const,
                    function: { name: 'danger_tool', arguments: '{}' },
                  },
                ],
                type: 'request_human_approve' as const,
              },
            ];
          }
          return { type: 'finish' as const, reason: 'completed' as const };
        }
      }

      const agent = new BlockingAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        sessionId: 'blocking-test',
        messages: [{ role: 'user', content: 'Execute' }],
      });

      const result = await runtime.step(state);

      // Safe tool should have been executed
      expect(agent.tools.safe_tool).toHaveBeenCalled();

      // Should be in waiting state (blocked by approval request)
      expect(result.newState.status).toBe('waiting_for_human');

      // Should have pending tool calls
      expect(result.newState.pendingToolsCalling).toHaveLength(1);
      expect(result.newState.pendingToolsCalling![0].function.name).toBe('danger_tool');

      // Should have both tool_result and human_approve_required events
      expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool_result' }));
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'human_approve_required' }),
      );
    });

    it('should merge tool results correctly', async () => {
      // Agent that returns batch with tools that modify usage/cost
      class UsageTrackingAgent implements Agent {
        tools = {
          expensive_tool: vi.fn().mockResolvedValue({ cost: 10 }),
          cheap_tool: vi.fn().mockResolvedValue({ cost: 1 }),
        };

        calculateUsage(
          operationType: 'llm' | 'tool' | 'human_interaction',
          operationResult: any,
          previousUsage: Usage,
        ): Usage {
          if (operationType === 'tool') {
            return {
              ...previousUsage,
              tools: {
                ...previousUsage.tools,
                totalCalls: previousUsage.tools.totalCalls + 1,
                totalTimeMs: previousUsage.tools.totalTimeMs + 100,
              },
            };
          }
          return previousUsage;
        }

        async runner(context: AgentRuntimeContext, _state: AgentState) {
          if (context.phase === 'user_input') {
            return {
              payload: [
                {
                  id: 'call_expensive',
                  type: 'function' as const,
                  function: { name: 'expensive_tool', arguments: '{}' },
                },
                {
                  id: 'call_cheap',
                  type: 'function' as const,
                  function: { name: 'cheap_tool', arguments: '{}' },
                },
              ],
              type: 'call_tools_batch' as const,
            };
          }
          return { type: 'finish' as const, reason: 'completed' as const };
        }
      }

      const agent = new UsageTrackingAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        sessionId: 'merge-test',
        messages: [{ role: 'user', content: 'Execute' }],
      });

      const result = await runtime.step(state);

      // Both tools should have been called
      expect(agent.tools.expensive_tool).toHaveBeenCalled();
      expect(agent.tools.cheap_tool).toHaveBeenCalled();

      // Usage should be merged (2 tools called)
      expect(result.newState.usage.tools.totalCalls).toBe(2);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle unknown instruction type', async () => {
      const agent = new MockAgent();
      agent.runner = vi.fn().mockResolvedValue({ type: 'unknown_instruction_type' as any });

      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({ sessionId: 'test-session' });

      const result = await runtime.step(state);

      expect(result.events[0].type).toBe('error');
      expect((result.events[0] as AgentEventError).error.message).toContain(
        'No executor found for instruction type',
      );
    });

    it('should handle LLM errors', async () => {
      const agent = new MockAgent();
      agent.modelRuntime = async function* () {
        throw new Error('LLM API error');
      };

      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        messages: [{ role: 'user', content: 'test' }],
        sessionId: 'test-session',
      });

      const result = await runtime.step(state);

      expect(result.events[0].type).toBe('error');
      expect((result.events[0] as AgentEventError).error.message).toBe('LLM API error');
    });

    it('should handle cost limit with warn action', async () => {
      class WarnCostAgent implements Agent {
        async runner(context: AgentRuntimeContext, state: AgentState) {
          return { type: 'call_llm' as const, payload: { messages: state.messages } };
        }

        calculateCost(context: CostCalculationContext): Cost {
          return {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            llm: { byModel: [], currency: 'USD', total: 15.0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
            total: 15.0,
          };
        }

        modelRuntime = async function* () {
          yield { content: 'test' };
        };
      }

      const agent = new WarnCostAgent();
      const runtime = new AgentRuntime(agent);

      const costLimit: CostLimit = {
        currency: 'USD',
        maxTotalCost: 10.0,
        onExceeded: 'warn',
      };

      const state = AgentRuntime.createInitialState({
        costLimit,
        messages: [{ role: 'user', content: 'test' }],
        sessionId: 'test-session',
      });

      const result = await runtime.step(state);

      expect(result.events[0]).toMatchObject({
        type: 'error',
      });
      expect((result.events[0] as AgentEventError).error.message).toContain(
        'Warning: Cost limit exceeded',
      );
      expect(result.newState.status).toBe('running');
    });

    it('should track tool cost limits', async () => {
      class ToolCostAgent implements Agent {
        tools = {
          expensive_tool: vi.fn().mockResolvedValue({ result: 'done' }),
        };

        async runner(context: AgentRuntimeContext, state: AgentState) {
          if (context.phase === 'user_input') {
            return {
              payload: {
                apiName: 'expensive_tool',
                arguments: '{}',
                id: 'call_1',
                identifier: 'expensive_tool',
                type: 'default' as const,
              },
              type: 'call_tool' as const,
            };
          }
          return { reason: 'completed' as const, type: 'finish' as const };
        }

        calculateCost(context: CostCalculationContext): Cost {
          return {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 20.0 },
            total: 20.0,
          };
        }
      }

      const agent = new ToolCostAgent();
      const runtime = new AgentRuntime(agent);

      const costLimit: CostLimit = {
        currency: 'USD',
        maxTotalCost: 10.0,
        onExceeded: 'stop',
      };

      const state = AgentRuntime.createInitialState({
        costLimit,
        messages: [{ role: 'user', content: 'test' }],
        sessionId: 'test-session',
      });

      const result = await runtime.step(state);

      expect(result.newState.status).toBe('done');
      expect(result.events[0]).toMatchObject({
        reason: 'cost_limit_exceeded',
        type: 'done',
      });
    });

    it('should merge cost statistics in batch tool execution', async () => {
      class BatchCostAgent implements Agent {
        tools = {
          tool_1: vi.fn().mockResolvedValue({ result: 'result_1' }),
          tool_2: vi.fn().mockResolvedValue({ result: 'result_2' }),
        };

        calculateCost(context: CostCalculationContext): Cost {
          const baseCost = context.previousCost || {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
            total: 0,
          };

          return {
            ...baseCost,
            calculatedAt: new Date().toISOString(),
            tools: {
              byTool: [],
              currency: 'USD',
              total: baseCost.tools.total + 5.0,
            },
            total: baseCost.total + 5.0,
          };
        }

        async runner(context: AgentRuntimeContext, _state: AgentState) {
          if (context.phase === 'user_input') {
            return {
              payload: [
                {
                  apiName: 'tool_1',
                  arguments: '{}',
                  id: 'call_1',
                  identifier: 'tool_1',
                  type: 'default' as const,
                },
                {
                  apiName: 'tool_2',
                  arguments: '{}',
                  id: 'call_2',
                  identifier: 'tool_2',
                  type: 'default' as const,
                },
              ],
              type: 'call_tools_batch' as const,
            };
          }
          return { reason: 'completed' as const, type: 'finish' as const };
        }
      }

      const agent = new BatchCostAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        messages: [{ role: 'user', content: 'Execute' }],
        sessionId: 'cost-merge-test',
      });

      const result = await runtime.step(state);

      // Cost should be merged from both tools
      expect(result.newState.cost.tools.total).toBeGreaterThan(0);
      expect(result.newState.cost.total).toBeGreaterThan(0);
    });

    it('should merge per-tool usage statistics in batch execution', async () => {
      class DetailedUsageAgent implements Agent {
        tools = {
          analytics_tool: vi.fn().mockResolvedValue({ result: 'analytics_done' }),
          logging_tool: vi.fn().mockResolvedValue({ result: 'logged' }),
        };

        calculateUsage(
          operationType: 'llm' | 'tool' | 'human_interaction',
          operationResult: any,
          previousUsage: Usage,
        ): Usage {
          if (operationType === 'tool') {
            const toolName = operationResult.toolCall.apiName;
            const newUsage = structuredClone(previousUsage);

            newUsage.tools.totalCalls += 1;
            newUsage.tools.totalTimeMs += 100;

            const existingTool = newUsage.tools.byTool.find((t) => t.name === toolName);
            if (existingTool) {
              existingTool.calls += 1;
              existingTool.totalTimeMs += 100;
            } else {
              newUsage.tools.byTool.push({
                calls: 1,
                errors: 0,
                name: toolName,
                totalTimeMs: 100,
              });
            }

            return newUsage;
          }
          return previousUsage;
        }

        async runner(context: AgentRuntimeContext, _state: AgentState) {
          if (context.phase === 'user_input') {
            return {
              payload: [
                {
                  apiName: 'analytics_tool',
                  arguments: '{}',
                  id: 'call_analytics',
                  identifier: 'analytics_tool',
                  type: 'default' as const,
                },
                {
                  apiName: 'logging_tool',
                  arguments: '{}',
                  id: 'call_logging',
                  identifier: 'logging_tool',
                  type: 'default' as const,
                },
              ],
              type: 'call_tools_batch' as const,
            };
          }
          return { reason: 'completed' as const, type: 'finish' as const };
        }
      }

      const agent = new DetailedUsageAgent();
      const runtime = new AgentRuntime(agent);
      const state = AgentRuntime.createInitialState({
        messages: [{ role: 'user', content: 'Execute' }],
        sessionId: 'usage-merge-test',
      });

      const result = await runtime.step(state);

      // Should have per-tool statistics
      expect(result.newState.usage.tools.totalCalls).toBe(2);
      const analyticsTool = result.newState.usage.tools.byTool.find(
        (t) => t.name === 'analytics_tool',
      );
      const loggingTool = result.newState.usage.tools.byTool.find((t) => t.name === 'logging_tool');
      expect(analyticsTool).toBeDefined();
      expect(analyticsTool!.calls).toBe(1);
      expect(loggingTool).toBeDefined();
      expect(loggingTool!.calls).toBe(1);
    });
  });
});
