import { describe, expect, it, vi } from 'vitest';

import { createThreadHooks, pickThreadCarryOver } from '../threadRunHooks';

describe('pickThreadCarryOver', () => {
  it('ignores legacy totalSteps when no versioned LLM baseline exists', () => {
    const baseline = pickThreadCarryOver({ totalSteps: 9 } as any);

    // Legacy `totalSteps` is in execution-step units; reusing it would mix units.
    expect(baseline.totalLlmCalls).toBeUndefined();
  });

  it('uses the versioned totalLlmCalls baseline', () => {
    const baseline = pickThreadCarryOver({ totalLlmCalls: 3, totalSteps: 9 } as any);

    expect(baseline.totalLlmCalls).toBe(3);
  });
});

/**
 * The thread-completion hook copies a sub-agent's final answer into its source
 * message — the placeholder the parent reads. A background run's placeholder
 * holds the start receipt instead, which must survive: its answer is delivered
 * to the parent as a message of its own.
 */
describe('createThreadHooks thread-completion', () => {
  const finalState = {
    messages: [
      { content: 'go', role: 'user' },
      { content: 'the answer', role: 'assistant' },
    ],
    operationId: 'child-op',
  };

  const runCompletion = async (options?: { updateSourceMessage?: boolean }) => {
    const messageModel = { update: vi.fn().mockResolvedValue(undefined) };
    const threadModel = { update: vi.fn().mockResolvedValue(undefined) };
    const hooks = createThreadHooks(
      {} as any,
      threadModel as any,
      messageModel as any,
      'thread-1',
      new Date().toISOString(),
      'placeholder-1',
      'execVirtualSubAgent',
      { sourceToolCallId: 'call-1', totalTokens: 10 },
      options,
    );
    const completion = hooks.find((hook) => hook.id === 'thread-completion')!;
    await completion.handler!({ finalState, operationId: 'child-op', reason: 'done' } as any);
    return { messageModel, threadModel };
  };

  it('copies the answer into the source message by default', async () => {
    const { messageModel } = await runCompletion();

    expect(messageModel.update).toHaveBeenCalledWith('placeholder-1', { content: 'the answer' });
  });

  it('leaves the source message alone for a background run, but still settles the thread', async () => {
    const { messageModel, threadModel } = await runCompletion({ updateSourceMessage: false });

    expect(messageModel.update).not.toHaveBeenCalled();
    expect(threadModel.update).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({ status: expect.anything() }),
    );
  });

  // Thread writes replace metadata; dropping the marker would turn the
  // sub-agent back into a plain thread in the UI once it finishes.
  it('keeps the spawning tool call on the finished thread', async () => {
    const { threadModel } = await runCompletion();

    expect(threadModel.update).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ sourceToolCallId: 'call-1' }),
      }),
    );
  });
});
