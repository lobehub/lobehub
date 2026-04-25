import { createAction, createSignal } from '@lobechat/agent-signal';
import { describe, expect, it, vi } from 'vitest';

const loadCreateRuntime = async () => {
  vi.resetModules();

  const [runtimeModule, middlewareModule] = await Promise.all([
    import('../AgentSignalRuntime'),
    import('../middleware'),
  ]);

  return {
    createAgentSignalRuntime: runtimeModule.createAgentSignalRuntime,
    defineActionHandler: middlewareModule.defineActionHandler,
    defineAgentSignalHandlers: middlewareModule.defineAgentSignalHandlers,
    defineSignalHandler: middlewareModule.defineSignalHandler,
    defineSourceHandler: middlewareModule.defineSourceHandler,
  };
};

describe('createAgentSignalRuntime', () => {
  /**
   * @example
   * const runtime = await createAgentSignalRuntime({
   *   policies: [defineAgentSignalHandlers([...])],
   * });
   *
   * const result = await runtime.emit(sourceInput);
   * expect(result.status).toBe('completed');
   */
  it('installs middleware-defined source, signal, and action handlers', async () => {
    const {
      createAgentSignalRuntime,
      defineActionHandler,
      defineAgentSignalHandlers,
      defineSignalHandler,
      defineSourceHandler,
    } = await loadCreateRuntime();
    const handled: string[] = [];

    const runtime = await createAgentSignalRuntime({
      policies: [
        defineAgentSignalHandlers([
          defineSourceHandler('source.user.message', {
            async handle(source, context) {
              handled.push(`source:${context.scopeKey}`);

              return {
                signals: [
                  createSignal({
                    payload: { text: source.payload.text as string },
                    signalType: 'signal.memory.request',
                    source,
                  }),
                ],
                status: 'dispatch',
              } as const;
            },
            id: 'test-source-handler',
          }),
          defineSignalHandler('signal.memory.request', {
            async handle(signal, context) {
              handled.push(`signal:${context.scopeKey}`);

              return {
                actions: [
                  createAction({
                    actionType: 'action.memory.persist',
                    payload: { text: signal.payload.text as string },
                    signal,
                  }),
                ],
                status: 'dispatch',
              } as const;
            },
            id: 'test-signal-handler',
          }),
          defineActionHandler('action.memory.persist', {
            async handle(action, context) {
              handled.push(`action:${context.scopeKey}`);

              return {
                actionId: action.actionId,
                attempt: { completedAt: 3, current: 1, startedAt: 1, status: 'succeeded' },
                detail: action.payload.text as string,
                status: 'applied',
              } as const;
            },
            id: 'test-action-handler',
          }),
        ]),
      ],
    });

    const result = await runtime.emit({
      payload: { text: 'remember this' },
      scope: {
        topicId: 'topic_1',
        userId: 'user_1',
      },
      sourceType: 'source.user.message',
      timestamp: 1_710_000_000_000,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('expected completed runtime result');

    expect(handled).toEqual([
      'source:topic:topic_1',
      'signal:topic:topic_1',
      'action:topic:topic_1',
    ]);
    expect(result.trace.actions.map((item) => item.actionType)).toEqual(['action.memory.persist']);
    expect(result.trace.results.map((item) => item.status)).toEqual(['applied']);
  });

  /**
   * @example
   * const runtime = await createAgentSignalRuntime();
   *
   * expect(runtime.runtimeConfig.backend).toBe('memory');
   */
  it('defaults to the in-memory durable backend without requiring default policies', async () => {
    const { createAgentSignalRuntime } = await loadCreateRuntime();
    const runtime = await createAgentSignalRuntime();

    expect(runtime.runtimeConfig).toEqual({
      backend: 'memory',
      durableRuntimeEnabled: false,
      runtimeEnabled: true,
    });
    expect(typeof runtime.durableBackend.claimPending).toBe('function');
    expect(typeof runtime.durableBackend.complete).toBe('function');
    expect(typeof runtime.durableBackend.fail).toBe('function');
    expect(typeof runtime.durableBackend.scheduleNextHop).toBe('function');
  });

  /**
   * @example
   * const runtime = await createAgentSignalRuntime({ policies: [] });
   *
   * const result = await runtime.emit(sourceInput);
   * expect(result.status).toBe('completed');
   */
  it('still emits successfully when no policies are installed', async () => {
    const { createAgentSignalRuntime } = await loadCreateRuntime();
    const runtime = await createAgentSignalRuntime({ policies: [] });

    const result = await runtime.emit({
      payload: { text: 'hello' },
      scope: {
        topicId: 'topic_1',
        userId: 'user_1',
      },
      sourceType: 'source.user.message',
      timestamp: 1_710_000_000_100,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('expected completed runtime result');
    expect(result.trace.actions).toEqual([]);
    expect(result.trace.results).toEqual([]);
    expect(result.trace.signals).toEqual([]);
  });

  /**
   * @example
   * const runtime = await createAgentSignalRuntime({ durableBackend, policies: [] });
   *
   * expect(runtime.durableBackend).toBe(durableBackend);
   */
  it('uses an injected durable backend when provided', async () => {
    const { createAgentSignalRuntime } = await loadCreateRuntime();
    const durableBackend = {
      appendToWaypoint: vi.fn().mockResolvedValue(undefined),
      claimPending: vi.fn().mockResolvedValue(null),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      loadWaypoint: vi.fn().mockResolvedValue({ events: [], scopeKey: 'topic:1' }),
      scheduleNextHop: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = await createAgentSignalRuntime({
      durableBackend,
      policies: [],
    });

    expect(runtime.durableBackend).toBe(durableBackend);
    await runtime.emit({
      payload: { text: 'hello' },
      scope: {
        topicId: 'topic_1',
        userId: 'user_1',
      },
      sourceType: 'source.user.message',
      timestamp: 1_710_000_000_300,
    });
    expect(durableBackend.appendToWaypoint).toHaveBeenCalled();
  });
});
