import { describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const { lobeAgentRuntime } = await import('../lobeAgent');

describe('lobeAgentRuntime cancelSubAgent', () => {
  const context = {
    messageId: 'msg-1',
    serverDB: {} as any,
    toolManifestMap: {},
    topicId: 'topic-1',
    userId: 'user-1',
  } as ToolExecutionContext;

  const withCancel = (cancel: ReturnType<typeof vi.fn>) =>
    ({ ...context, subAgent: { cancel, run: vi.fn() } }) as ToolExecutionContext;

  it('cancels the sub-agent and tells the parent how to steer it', async () => {
    const cancel = vi.fn().mockResolvedValue({
      operationId: 'sub-op-1',
      status: 'cancelled',
      stopped: true,
      threadId: 'thread-1',
    });
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.cancelSubAgent(
      { reason: 'The user no longer needs it', subAgentId: ' thread-1 ' },
      withCancel(cancel),
    );

    expect(cancel).toHaveBeenCalledWith({ subAgentId: 'thread-1' });
    expect(result).toMatchObject({
      state: { status: 'cancelled', threadId: 'thread-1' },
      success: true,
    });
    expect(result.content).toContain('cancelled');
    expect(result.content).toMatch(/no result will be delivered/i);
    expect(result.content).toContain('callSubAgent with subAgentId "thread-1"');
    expect(result.content).toContain('stopped');
  });

  it('tells the parent to wait for a sub-agent still finishing its step', async () => {
    const cancel = vi.fn().mockResolvedValue({
      status: 'cancelled',
      stopped: false,
      threadId: 'thread-1',
    });
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.cancelSubAgent({ subAgentId: 'thread-1' }, withCancel(cancel));

    expect(result).toMatchObject({ state: { status: 'cancelled' }, success: true });
    expect(result.content).toContain('still finishing its current step');
    expect(result.content).toContain('once it has stopped');
  });

  it('reports a sub-agent that is no longer running without failing', async () => {
    const cancel = vi.fn().mockResolvedValue({ status: 'not_running', threadId: 'thread-1' });
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.cancelSubAgent({ subAgentId: 'thread-1' }, withCancel(cancel));

    expect(result).toMatchObject({
      state: { status: 'not_running', threadId: 'thread-1' },
      success: true,
    });
    expect(result.content).toContain('not running');
  });

  it('surfaces a refused cancel as a tool error', async () => {
    const cancel = vi.fn().mockResolvedValue({
      error: 'Sub-agent "thread-9" was not found in this conversation.',
      status: 'failed',
      threadId: 'thread-9',
    });
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.cancelSubAgent({ subAgentId: 'thread-9' }, withCancel(cancel));

    expect(result).toMatchObject({ error: { code: 'SUB_AGENT_CANCEL_FAILED' }, success: false });
    expect(result.content).toContain('was not found in this conversation');
  });

  it.each([[''], ['   '], [undefined], [42]])(
    'rejects a missing subAgentId (%s) without cancelling anything',
    async (subAgentId) => {
      const cancel = vi.fn();
      const runtime = lobeAgentRuntime.factory(context);

      const result = await runtime.cancelSubAgent(
        { subAgentId: subAgentId as any },
        withCancel(cancel),
      );

      expect(result).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' }, success: false });
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it('refuses inside a sub-agent', async () => {
    const cancel = vi.fn();
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.cancelSubAgent({ subAgentId: 'thread-1' }, {
      ...withCancel(cancel),
      isSubAgent: true,
    } as ToolExecutionContext);

    expect(result).toMatchObject({ error: { code: 'NESTED_SUB_AGENT_NOT_ALLOWED' } });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses when the runtime cannot cancel', async () => {
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.cancelSubAgent({ subAgentId: 'thread-1' }, {
      ...context,
      subAgent: { run: vi.fn() },
    } as ToolExecutionContext);

    expect(result).toMatchObject({ error: { code: 'SUB_AGENT_UNAVAILABLE' }, success: false });
  });
});
