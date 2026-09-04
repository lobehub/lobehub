import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeContext, AgentState } from '../types';
import { type AgentLoopStep, resolveStopReason, runAgentLoop } from './index';

const createState = (overrides: Partial<AgentState> = {}): AgentState =>
  ({
    cost: { total: 0 },
    maxSteps: 100,
    messages: [],
    operationId: 'op-1',
    status: 'running',
    stepCount: 0,
    ...overrides,
  }) as AgentState;

const context = (phase = 'user_input') => ({ payload: {}, phase }) as AgentRuntimeContext;

/** A step that runs `count` times, then produces no next context. */
const finiteStep = (count: number): AgentLoopStep => {
  let remaining = count;
  return async ({ state }) => {
    remaining -= 1;
    return { nextContext: remaining > 0 ? context('tool_result') : undefined, state };
  };
};

describe('resolveStopReason', () => {
  it.each([
    ['done', 'done'],
    ['error', 'error'],
    ['interrupted', 'interrupted'],
    ['waiting_for_human', 'parked'],
    ['waiting_for_async_tool', 'parked'],
  ] as const)('maps status %s to %s', (status, reason) => {
    expect(resolveStopReason(createState({ status }), context())).toBe(reason);
  });

  it('reports a missing next context rather than looping on nothing', () => {
    expect(resolveStopReason(createState(), undefined)).toBe('no_next_context');
  });

  it('continues while running with a context to feed forward', () => {
    expect(resolveStopReason(createState(), context())).toBeUndefined();
  });

  it('stops on an exhausted cost budget only when configured to stop', () => {
    const exceeded = (onExceeded: 'stop' | 'warn' | 'interrupt') =>
      createState({
        cost: { total: 10 } as never,
        costLimit: { currency: 'USD', maxTotalCost: 5, onExceeded },
      });

    expect(resolveStopReason(exceeded('stop'), context())).toBe('cost_limit');
    // `warn` and `interrupt` settle up elsewhere; the loop keeps going.
    expect(resolveStopReason(exceeded('warn'), context())).toBeUndefined();
    expect(resolveStopReason(exceeded('interrupt'), context())).toBeUndefined();
  });
});

describe('runAgentLoop', () => {
  it('feeds each step the previous step’s next context', async () => {
    const seen: (string | undefined)[] = [];
    const step: AgentLoopStep = async ({ context: ctx, state, stepIndex }) => {
      seen.push(ctx?.phase);
      return {
        nextContext: stepIndex < 2 ? context(`after-${stepIndex}`) : undefined,
        state,
      };
    };

    const result = await runAgentLoop({ initialContext: context('start'), state: createState(), step });

    expect(seen).toEqual(['start', 'after-0', 'after-1']);
    expect(result.stepCount).toBe(3);
    expect(result.reason).toBe('no_next_context');
  });

  it('does not step a state that is already finished', async () => {
    const step = vi.fn();

    const result = await runAgentLoop({
      initialContext: context(),
      state: createState({ status: 'done' }),
      step,
    });

    // Resuming a parked or finished operation is a different entry point.
    // Stepping it again here would run a turn the host never asked for.
    expect(step).not.toHaveBeenCalled();
    expect(result.reason).toBe('done');
    expect(result.stepCount).toBe(0);
  });

  it('stops as soon as a step parks the run', async () => {
    const step: AgentLoopStep = async ({ state }) => ({
      nextContext: context('tool_result'),
      state: { ...state, status: 'waiting_for_human' },
    });

    const result = await runAgentLoop({ initialContext: context(), state: createState(), step });

    // The browser loop condition (`!== 'done' && !== 'error'`) would have run
    // another step here; it only escaped because its steps happen to return no
    // next context when parked. This makes the rule explicit instead.
    expect(result.reason).toBe('parked');
    expect(result.stepCount).toBe(1);
  });

  it('honours the caller step budget separately from state.maxSteps', async () => {
    const step = vi.fn(async ({ state }: { state: AgentState }) => ({
      nextContext: context('tool_result'),
      state,
    }));

    const result = await runAgentLoop({
      initialContext: context(),
      maxSteps: 3,
      state: createState(),
      step: step as AgentLoopStep,
    });

    expect(step).toHaveBeenCalledTimes(3);
    expect(result.reason).toBe('max_steps');
    // The context the next step would have received survives, so a caller can
    // resume from exactly where the budget ran out.
    expect(result.context?.phase).toBe('tool_result');
  });

  it('runs a turn that opens with no context', async () => {
    const step = vi.fn(async ({ state }: { state: AgentState }) => ({
      state: { ...state, status: 'done' } as AgentState,
    }));

    // "No next context" describes what a step PRODUCED, so it cannot be asked
    // before the first step. A run legitimately opens without one — treating
    // that as a stop would end every loop before it began.
    const result = await runAgentLoop({ state: createState(), step: step as AgentLoopStep });

    expect(step).toHaveBeenCalledTimes(1);
    expect(result.reason).toBe('done');
  });

  it('reports each completed step to the caller', async () => {
    const seen: number[] = [];

    await runAgentLoop({
      initialContext: context(),
      onStepComplete: (stepIndex) => {
        seen.push(stepIndex);
      },
      state: createState(),
      step: finiteStep(3),
    });

    expect(seen).toEqual([1, 2, 3]);
  });

  it('lets a host add a termination rule of its own', async () => {
    const step = vi.fn(async ({ state }: { state: AgentState }) => ({
      nextContext: context('tool_result'),
      state,
    }));

    const result = await runAgentLoop({
      initialContext: context(),
      resolveStop: (state, ctx) => (state.stepCount >= 0 && ctx?.phase === 'tool_result'
        ? 'interrupted'
        : resolveStopReason(state, ctx)),
      state: createState(),
      step: step as AgentLoopStep,
    });

    expect(step).toHaveBeenCalledTimes(1);
    expect(result.reason).toBe('interrupted');
  });

  it('surfaces the final state, not the one it started from', async () => {
    const step: AgentLoopStep = async ({ state }) => ({
      state: { ...state, status: 'done', stepCount: state.stepCount + 1 },
    });

    const result = await runAgentLoop({ initialContext: context(), state: createState(), step });

    expect(result.state.status).toBe('done');
    expect(result.state.stepCount).toBe(1);
  });
});
