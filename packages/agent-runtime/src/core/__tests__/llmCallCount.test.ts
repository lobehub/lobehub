import { describe, expect, it, vi } from 'vitest';

import type { Agent, AgentRuntimeContext, AgentState, Usage } from '../../types';
import { getLlmCallCount, withLlmAttemptCount } from '../../utils/llmCalls';
import { AgentRuntime } from '../runtime';

const createContext = (): AgentRuntimeContext => ({
  payload: {},
  phase: 'user_input',
  session: {
    messageCount: 1,
    sessionId: 'test-op',
    status: 'idle',
    stepCount: 0,
  },
});

const createAgent = (): Agent =>
  ({
    executors: {},
    modelRuntime: async function* () {
      yield { content: 'ok' };
    },
    runner: async (context: AgentRuntimeContext) =>
      context.phase === 'user_input'
        ? { payload: { messages: [] }, type: 'call_llm' }
        : { reason: 'completed', reasonDetail: 'Done', type: 'finish' },
    tools: {},
  }) as unknown as Agent;

const createUsage = (apiCalls: number): Usage => ({
  humanInteraction: {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  },
  llm: {
    apiCalls,
    processingTimeMs: 0,
    tokens: { input: 0, output: 0, total: 0 },
  },
  tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
});

describe('llmCalls metric', () => {
  it('increments llmCalls for LLM work but not for a finish-only step', async () => {
    const runtime = new AgentRuntime(createAgent());
    const state = AgentRuntime.createInitialState({
      messages: [{ content: 'hi', role: 'user' }],
      operationId: 'test-op',
    });

    const first = await runtime.step(state, createContext());
    expect(first.newState.stepCount).toBe(1);
    expect(first.newState.llmCalls).toBe(1);

    const second = await runtime.step(first.newState, first.nextContext);
    // `finish` is not a real execution step and not an LLM call either.
    expect(second.newState.stepCount).toBe(1);
    expect(second.newState.llmCalls).toBe(1);
  });

  it('counts provider attempts when the LLM call fails terminally', async () => {
    const runtime = new AgentRuntime(createAgent());
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi
      .fn()
      .mockRejectedValue(withLlmAttemptCount(new Error('provider down'), 3));

    const state = AgentRuntime.createInitialState({ operationId: 'test-op' });
    const result = await runtime.step(state, createContext());

    expect(result.newState.status).toBe('error');
    expect(result.newState.usage?.llm.apiCalls).toBe(3);
    expect(result.newState.llmCalls).toBe(3);
  });

  it('adds retried attempts on top of a resumed baseline', async () => {
    const runtime = new AgentRuntime(createAgent());
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi.fn().mockImplementation(async (_instruction, state) => ({
      events: [],
      newState: { ...state, usage: createUsage(2) },
    }));

    const state = {
      ...AgentRuntime.createInitialState({ operationId: 'test-op' }),
      llmCalls: 5,
      usage: createUsage(0),
    };

    const result = await runtime.step(state, createContext());

    // 5 calls from the resumed trajectory + 2 provider attempts in this step,
    // not max(2, 6).
    expect(result.newState.llmCalls).toBe(7);
  });

  it('counts every call_llm instruction in one step when the executor leaves usage untouched', async () => {
    // A runner may queue several LLM calls in a single step; the executor here
    // does not mutate `usage`, so the fallback has to count the instructions
    // instead of treating the step as one call.
    const agent = {
      ...createAgent(),
      runner: async () =>
        [
          { payload: { messages: [] }, type: 'call_llm' },
          { payload: { messages: [] }, type: 'call_llm' },
        ] as any,
    } as unknown as Agent;
    const runtime = new AgentRuntime(agent);
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi
      .fn()
      .mockImplementation(async (_instruction, state) => ({ events: [], newState: state }));

    const state = AgentRuntime.createInitialState({ operationId: 'test-op' });
    const result = await runtime.step(state, createContext());

    expect(result.newState.llmCalls).toBe(2);
  });

  it('keeps the earlier calls of a step when a later LLM call fails', async () => {
    // Two `call_llm` instructions in one step: the first succeeded, the second
    // burned two provider attempts and threw. Rebuilding the error state from
    // the step-entry state used to report 2 calls and lose the first one.
    const agent = {
      ...createAgent(),
      runner: async () =>
        [
          { payload: { messages: [] }, type: 'call_llm' },
          { payload: { messages: [] }, type: 'call_llm' },
        ] as any,
    } as unknown as Agent;
    const runtime = new AgentRuntime(agent);
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi
      .fn()
      .mockImplementationOnce(async (_instruction, state) => ({
        events: [],
        newState: { ...state, usage: createUsage(1) },
      }))
      .mockRejectedValueOnce(withLlmAttemptCount(new Error('provider down'), 2));

    const state = AgentRuntime.createInitialState({ operationId: 'test-op' });
    const result = await runtime.step(state, createContext());

    expect(result.newState.status).toBe('error');
    expect(result.newState.usage?.llm.apiCalls).toBe(3);
    expect(result.newState.llmCalls).toBe(3);
  });

  it('keeps the calls of a step whose later non-LLM instruction throws', async () => {
    // The successful call must not be reported as zero just because a tool in
    // the same step exploded afterwards.
    const agent = {
      ...createAgent(),
      runner: async () =>
        [
          { payload: { messages: [] }, type: 'call_llm' },
          { payload: { toolCalling: {}, type: 'default' }, type: 'call_tool' },
        ] as any,
    } as unknown as Agent;
    const runtime = new AgentRuntime(agent);
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi.fn().mockImplementation(async (_instruction, state) => ({
      events: [],
      newState: { ...state, usage: createUsage(1) },
    }));
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_tool = vi.fn().mockRejectedValue(new Error('tool exploded'));

    const state = AgentRuntime.createInitialState({ operationId: 'test-op' });
    const result = await runtime.step(state, createContext());

    expect(result.newState.status).toBe('error');
    expect(result.newState.llmCalls).toBe(1);
  });

  it('does not count a call_llm that failed before the transport ran', async () => {
    // Missing model/provider, an absent parent message, or a rejected context
    // all throw before `runAttempt`, so no provider call happened. The fallback
    // must not invent one just because the instruction was queued.
    const runtime = new AgentRuntime(createAgent());
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi
      .fn()
      .mockRejectedValue(new Error('call_llm produced no non-system messages'));

    const state = AgentRuntime.createInitialState({ operationId: 'test-op' });
    const result = await runtime.step(state, createContext());

    expect(result.newState.status).toBe('error');
    expect(result.newState.llmCalls).toBe(0);
    expect(result.newState.usage?.llm.apiCalls ?? 0).toBe(0);
  });

  it('counts only the call_llm instructions whose executor ran', async () => {
    // The first call reached the transport and left `usage` untouched, so the
    // fallback counts it; the second failed preflight and never reached the
    // provider, so it must not be counted on top.
    const agent = {
      ...createAgent(),
      runner: async () =>
        [
          { payload: { messages: [] }, type: 'call_llm' },
          { payload: { messages: [] }, type: 'call_llm' },
        ] as any,
    } as unknown as Agent;
    const runtime = new AgentRuntime(agent);
    // @ts-expect-error - accessing a private property for testing
    runtime.executors.call_llm = vi
      .fn()
      .mockImplementationOnce(async (_instruction, state) => ({ events: [], newState: state }))
      .mockRejectedValueOnce(new Error('Model and provider are required for call_llm'));

    const state = AgentRuntime.createInitialState({ operationId: 'test-op' });
    const result = await runtime.step(state, createContext());

    expect(result.newState.status).toBe('error');
    expect(result.newState.llmCalls).toBe(1);
  });

  it('reads the explicit llmCalls field before falling back to usage', () => {
    const state = { llmCalls: 5, usage: createUsage(2) } as AgentState;
    expect(getLlmCallCount(state)).toBe(5);

    expect(getLlmCallCount({ usage: createUsage(2) })).toBe(2);
    expect(getLlmCallCount(null)).toBe(0);
  });
});
