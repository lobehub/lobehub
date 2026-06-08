// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it, vi } from 'vitest';

import type { SelfIterationCompletionPayload } from '../services/selfIteration/completion';
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

const selfIteration: SelfIterationCompletionPayload = {
  artifacts: [],
  marker: { kind: 'nightly-review', sourceId: 'src_1' },
  mutations: [],
  userId: 'user_1',
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
        payload: { agentId: BUILTIN_AGENT_SLUGS.nightlyReview, operationId: 'op_1', selfIteration },
      }),
    ).resolves.toBeUndefined();
  });

  it('ignores runs that carry no marker payload, regardless of agent', async () => {
    const onSelfIterationCompleted = vi.fn();
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await handler.handle({
      payload: { agentId: BUILTIN_AGENT_SLUGS.nightlyReview, operationId: 'op_2' },
    });

    expect(onSelfIterationCompleted).not.toHaveBeenCalled();
  });

  it.each([
    [BUILTIN_AGENT_SLUGS.nightlyReview],
    [BUILTIN_AGENT_SLUGS.selfReflection],
    // A memory-writer runs as the user's own agent — not a self-iteration slug —
    // and must still route purely on the marker payload.
    ['agent_user_42'],
  ])('invokes the callback for a marked %s run and forwards the payload', async (agentId) => {
    const onSelfIterationCompleted = vi.fn().mockResolvedValue(undefined);
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await handler.handle({
      payload: { agentId, operationId: 'op_3', selfIteration, topicId: 'topic_3' },
    });

    expect(onSelfIterationCompleted).toHaveBeenCalledWith({
      agentId,
      operationId: 'op_3',
      selfIteration,
      topicId: 'topic_3',
    });
  });

  it('swallows callback errors so the worker is not blocked', async () => {
    const onSelfIterationCompleted = vi.fn().mockRejectedValue(new Error('boom'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await expect(
      handler.handle({
        payload: { agentId: BUILTIN_AGENT_SLUGS.nightlyReview, operationId: 'op_4', selfIteration },
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('skips when required fields are missing', async () => {
    const onSelfIterationCompleted = vi.fn();
    const [handler] = installAndCapture(createCompletionPolicy({ onSelfIterationCompleted }));

    await handler.handle({ payload: { operationId: 'op_5', selfIteration } });
    await handler.handle({
      payload: { agentId: BUILTIN_AGENT_SLUGS.nightlyReview, selfIteration },
    });

    expect(onSelfIterationCompleted).not.toHaveBeenCalled();
  });
});
