// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it, vi } from 'vitest';

import { createCompletionPolicy } from './completionPolicy';

interface CapturedHandler {
  handle: (source: { payload: Record<string, unknown> }) => Promise<void>;
  id: string;
  listen: string;
}

const installAndCapture = (middleware: ReturnType<typeof createCompletionPolicy>) => {
  const sourceHandlers: CapturedHandler[] = [];

  middleware.install({
    handleAction: vi.fn(),
    handleSignal: vi.fn(),
    handleSource: (handler: unknown) => {
      sourceHandlers.push(handler as CapturedHandler);
    },
  } as never);

  return sourceHandlers;
};

describe('createCompletionPolicy', () => {
  it('registers a single source handler on agent.execution.completed', () => {
    const handlers = installAndCapture(createCompletionPolicy());

    expect(handlers).toHaveLength(1);
    expect(handlers[0].listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted);
    expect(handlers[0].id).toBe('agent.execution.completed:completion-fanout');
  });

  it('is a no-op when the callback is not provided', async () => {
    const [handler] = installAndCapture(createCompletionPolicy());

    await expect(
      handler.handle({
        payload: {
          agentId: BUILTIN_AGENT_SLUGS.selfIteration,
          operationId: 'op_1',
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('ignores non-self-iteration agents even when a callback is provided', async () => {
    const onSelfIterationCompleted = vi.fn();
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await handler.handle({
      payload: { agentId: BUILTIN_AGENT_SLUGS.inbox, operationId: 'op_2' },
    });

    expect(onSelfIterationCompleted).not.toHaveBeenCalled();
  });

  it('invokes the callback for self-iteration runs', async () => {
    const onSelfIterationCompleted = vi.fn().mockResolvedValue(undefined);
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await handler.handle({
      payload: {
        agentId: BUILTIN_AGENT_SLUGS.selfIteration,
        operationId: 'op_3',
        topicId: 'topic_3',
      },
    });

    expect(onSelfIterationCompleted).toHaveBeenCalledWith({
      agentId: BUILTIN_AGENT_SLUGS.selfIteration,
      operationId: 'op_3',
      topicId: 'topic_3',
    });
  });

  it('swallows callback errors so the worker is not blocked', async () => {
    const error = new Error('boom');
    const onSelfIterationCompleted = vi.fn().mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await expect(
      handler.handle({
        payload: {
          agentId: BUILTIN_AGENT_SLUGS.selfIteration,
          operationId: 'op_4',
        },
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('skips when required fields are missing', async () => {
    const onSelfIterationCompleted = vi.fn();
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await handler.handle({ payload: { operationId: 'op_5' } });
    await handler.handle({ payload: { agentId: BUILTIN_AGENT_SLUGS.selfIteration } });

    expect(onSelfIterationCompleted).not.toHaveBeenCalled();
  });
});
