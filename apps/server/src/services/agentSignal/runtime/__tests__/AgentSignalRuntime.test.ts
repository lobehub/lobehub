import type { AgentSignalSource, BaseAction, BaseSignal } from '@lobechat/agent-signal';
import { createAction, createSignal } from '@lobechat/agent-signal';
import { describe, expect, it } from 'vitest';

import {
  AgentSignalScheduler,
  type AgentSignalSchedulerHandler,
  type AgentSignalSchedulerRegistry,
} from '../AgentSignalScheduler';
import type { RuntimeBackend, RuntimeNode, RuntimeWaypoint } from '../context';

interface TestGuardState {
  lastEventAt?: number;
  startedAt?: number;
}

const createRuntimeBackend = (): RuntimeBackend => {
  const guardState = new Map<string, TestGuardState>();
  const waypoints = new Map<string, RuntimeWaypoint>();

  return {
    async appendToWaypoint(scopeKey, source) {
      waypoints.set(scopeKey, { trigger: source });
    },
    async getGuardState(scopeKey, lane) {
      return guardState.get(`${scopeKey}:${lane}`) ?? {};
    },
    async loadWaypoint(scopeKey) {
      return waypoints.get(scopeKey) ?? {};
    },
    async touchGuardState(scopeKey, lane, now) {
      const key = `${scopeKey}:${lane}`;
      const current = guardState.get(key) ?? {};
      const next = {
        lastEventAt: now,
        startedAt: current.startedAt ?? now,
      } satisfies TestGuardState;

      guardState.set(key, next);

      return next;
    },
  };
};

const createRuntimeRegistry = <
  TNode extends RuntimeNode,
>(): AgentSignalSchedulerRegistry<TNode> => {
  const entries = new Map<string, Array<AgentSignalSchedulerHandler<TNode>>>();

  return {
    match(type) {
      return [...(entries.get(type) ?? [])];
    },
    register(type, entry) {
      const current = entries.get(type) ?? [];
      current.push(entry);
      entries.set(type, current);

      return this;
    },
  };
};

describe('AgentSignalScheduler', () => {
  /**
   * @example
   * const result = await runtime.emit({
   *   payload: { message: 'remember this' },
   *   scope: { agentId: 'agent-1', topicId: 'topic-1', userId: 'user-1' },
   *   sourceType: 'source.user.message',
   * });
   *
   * expect(result.status).toBe('completed');
   */
  it('accepts one generalized emit(source) entry', async () => {
    const backend = createRuntimeBackend();
    const actionRegistry = createRuntimeRegistry<BaseAction>();
    const signalRegistry = createRuntimeRegistry<BaseSignal>();
    const sourceRegistry = createRuntimeRegistry<AgentSignalSource>();
    const handled: string[] = [];

    sourceRegistry.register('source.user.message', {
      async handle(source, context) {
        handled.push(`source:${String(source.sourceType)}:${context.scopeKey}`);

        return {
          signals: [
            createSignal({
              payload: { message: source.payload.message as string },
              signalType: 'signal.memory.request',
              source,
            }),
          ],
          status: 'dispatch' as const,
        };
      },
      id: 'source-handler',
    });

    signalRegistry.register('signal.memory.request', {
      async handle(signal, context) {
        handled.push(`signal:${String(signal.signalType)}:${context.scopeKey}`);

        return {
          actions: [
            createAction({
              actionType: 'action.memory.persist',
              payload: { message: signal.payload.message as string },
              signal,
            }),
          ],
          status: 'dispatch' as const,
        };
      },
      id: 'signal-handler',
    });

    actionRegistry.register('action.memory.persist', {
      async handle(action, context) {
        handled.push(`action:${String(action.actionType)}:${context.scopeKey}`);

        expect(action.chain.rootSourceId).toContain('source:');
      },
      id: 'action-handler',
    });

    const runtime = new AgentSignalScheduler({
      actionRegistry,
      backend,
      signalRegistry,
      sourceRegistry,
    });

    const result = await runtime.emit({
      payload: { message: 'remember this' },
      scope: { agentId: 'agent-1', topicId: 'topic-1', userId: 'user-1' },
      sourceType: 'source.user.message',
    });

    expect(result.status).toBe('completed');
    expect(handled).toEqual([
      'source:source.user.message:topic:topic-1',
      'signal:signal.memory.request:topic:topic-1',
      'action:action.memory.persist:topic:topic-1',
    ]);

    await expect(backend.loadWaypoint('topic:topic-1')).resolves.toEqual(
      expect.objectContaining({
        trigger: expect.objectContaining({
          scopeKey: 'topic:topic-1',
          sourceType: 'source.user.message',
        }),
      }),
    );
  });

  /**
   * @example
   * const result = await runtime.emit({
   *   payload: { message: 'remember this later' },
   *   scope: { topicId: 'topic-1', userId: 'user-1' },
   *   sourceType: 'source.user.message',
   * });
   *
   * expect(result.status).toBe('wait');
   */
  it('returns terminal wait results instead of discarding them', async () => {
    const backend = createRuntimeBackend();
    const actionRegistry = createRuntimeRegistry<BaseAction>();
    const signalRegistry = createRuntimeRegistry<BaseSignal>();
    const sourceRegistry = createRuntimeRegistry<AgentSignalSource>();

    sourceRegistry.register('source.user.message', {
      async handle(_source, context) {
        expect(context.scopeKey).toBe('topic:topic-1');

        return {
          pending: { lane: 'user-feedback' },
          status: 'wait',
        } as const;
      },
      id: 'source-handler',
    });

    const runtime = new AgentSignalScheduler({
      actionRegistry,
      backend,
      signalRegistry,
      sourceRegistry,
    });

    const result = await runtime.emit({
      payload: { message: 'remember this later' },
      scope: { topicId: 'topic-1', userId: 'user-1' },
      sourceType: 'source.user.message',
    });

    expect(result).toEqual({
      pending: { lane: 'user-feedback' },
      status: 'wait',
    });
  });

  /**
   * @example
   * const result = await runtime.emit({
   *   payload: { message: 'remember this later' },
   *   scope: { topicId: 'topic-1', userId: 'user-1' },
   *   sourceType: 'source.user.message',
   * });
   *
   * expect(result.status).toBe('wait');
   * expect(handled).toContain('signal:signal.memory.request:topic:topic-1');
   */
  it('drains already-queued work before returning a terminal result', async () => {
    const backend = createRuntimeBackend();
    const actionRegistry = createRuntimeRegistry<BaseAction>();
    const signalRegistry = createRuntimeRegistry<BaseSignal>();
    const sourceRegistry = createRuntimeRegistry<AgentSignalSource>();
    const handled: string[] = [];

    sourceRegistry.register('source.user.message', {
      async handle(source, context) {
        handled.push(`source:dispatch:${context.scopeKey}`);

        return {
          signals: [
            createSignal({
              payload: { message: source.payload.message as string },
              signalType: 'signal.memory.request',
              source,
            }),
          ],
          status: 'dispatch',
        } as const;
      },
      id: 'source-dispatch-handler',
    });

    sourceRegistry.register('source.user.message', {
      async handle(_source, context) {
        handled.push(`source:wait:${context.scopeKey}`);

        return {
          pending: { lane: 'user-feedback' },
          status: 'wait',
        } as const;
      },
      id: 'source-wait-handler',
    });

    signalRegistry.register('signal.memory.request', {
      async handle(signal, context) {
        handled.push(`signal:${signal.signalType}:${context.scopeKey}`);
      },
      id: 'signal-handler',
    });

    const runtime = new AgentSignalScheduler({
      actionRegistry,
      backend,
      signalRegistry,
      sourceRegistry,
    });

    const result = await runtime.emit({
      payload: { message: 'remember this later' },
      scope: { topicId: 'topic-1', userId: 'user-1' },
      sourceType: 'source.user.message',
    });

    expect(result).toEqual({
      pending: { lane: 'user-feedback' },
      status: 'wait',
    });
    expect(handled).toEqual([
      'source:dispatch:topic:topic-1',
      'source:wait:topic:topic-1',
      'signal:signal.memory.request:topic:topic-1',
    ]);
  });

  /**
   * @example
   * const result = await runtime.emit({
   *   payload: { message: 'remember this' },
   *   scope: { topicId: 'topic-1', userId: 'user-1' },
   *   sourceType: 'source.user.message',
   * });
   *
   * expect(result.status).toBe('completed');
   * expect(result.trace.results).toHaveLength(3);
   */
  it('bridges executor-style action results into trace results and action-result signals', async () => {
    const backend = createRuntimeBackend();
    const actionRegistry = createRuntimeRegistry<BaseAction>();
    const signalRegistry = createRuntimeRegistry<BaseSignal>();
    const sourceRegistry = createRuntimeRegistry<AgentSignalSource>();

    sourceRegistry.register('source.user.message', {
      async handle(source) {
        return {
          signals: [
            createSignal({
              payload: { message: source.payload.message as string },
              signalType: 'signal.memory.request',
              source,
            }),
          ],
          status: 'dispatch',
        } as const;
      },
      id: 'source-handler',
    });

    signalRegistry.register('signal.memory.request', {
      async handle(signal) {
        return {
          actions: [
            createAction({
              actionType: 'action.memory.persist',
              payload: { outcome: 'applied' },
              signal,
            }),
            createAction({
              actionType: 'action.memory.persist',
              payload: { outcome: 'skipped' },
              signal,
            }),
            createAction({
              actionType: 'action.memory.persist',
              payload: { outcome: 'failed' },
              signal,
            }),
          ],
          status: 'dispatch',
        } as const;
      },
      id: 'signal-handler',
    });

    actionRegistry.register('action.memory.persist', {
      async handle(action) {
        const startedAt = 1_000;
        const outcome = action.payload.outcome;

        if (outcome === 'failed') {
          return {
            actionId: action.actionId,
            attempt: { current: 1, startedAt, status: 'failed' },
            error: { code: 'memory_failed', message: 'boom' },
            status: 'failed',
          } as const;
        }

        if (outcome === 'skipped') {
          return {
            actionId: action.actionId,
            attempt: { current: 1, startedAt, status: 'skipped' },
            status: 'skipped',
          } as const;
        }

        return {
          actionId: action.actionId,
          attempt: { current: 1, startedAt, status: 'succeeded' },
          status: 'applied',
        } as const;
      },
      id: 'action-handler',
    });

    const runtime = new AgentSignalScheduler({
      actionRegistry,
      backend,
      signalRegistry,
      sourceRegistry,
    });

    const result = await runtime.emit({
      payload: { message: 'remember this' },
      scope: { topicId: 'topic-1', userId: 'user-1' },
      sourceType: 'source.user.message',
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error('Expected completed runtime result');
    }

    expect(result.trace.results.map((entry) => entry.status)).toEqual([
      'applied',
      'skipped',
      'failed',
    ]);
    expect(
      result.trace.signals
        .map((signal) => signal.signalType)
        .filter((type) => type.startsWith('signal.action.')),
    ).toEqual(['signal.action.applied', 'signal.action.skipped', 'signal.action.failed']);
  });
});
