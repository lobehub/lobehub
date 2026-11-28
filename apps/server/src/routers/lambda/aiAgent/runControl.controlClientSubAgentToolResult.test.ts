// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runControlRouter } from './runControl';

const mocks = vi.hoisted(() => ({
  assertCanUseOperationAgent: vi.fn(),
  controlCompletedToolResult: vi.fn(),
}));

vi.mock('./guards', () => ({
  assertCanUseAgentRunConversation: vi.fn(),
  assertCanUseOperationAgent: mocks.assertCanUseOperationAgent,
}));
vi.mock('./procedures', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const procedure = trpc.procedure.use((opts) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        agentRuntimeService: { controlCompletedToolResult: mocks.controlCompletedToolResult },
        serverDB: {} as never,
      },
    }),
  );
  return { aiAgentWriteProcedure: procedure };
});

const caller = runControlRouter.createCaller({ userId: 'user-1', workspaceId: 'ws-1' } as never);

const input = {
  operationId: 'op-parent',
  result: { content: 'child final answer', state: { totalCost: 0.2 }, success: true },
  toolMessageId: 'msg-tool',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCanUseOperationAgent.mockResolvedValue(undefined);
});

describe('aiAgent.controlClientSubAgentToolResult', () => {
  it('runs the deferred result-control pipeline and returns the controlled result', async () => {
    mocks.controlCompletedToolResult.mockResolvedValue({
      blocked: true,
      result: { content: 'Blocked by hook', error: 'denied', state: { totalCost: 0.2 } },
    });

    await expect(caller.controlClientSubAgentToolResult(input)).resolves.toEqual({
      blocked: true,
      content: 'Blocked by hook',
      error: 'denied',
      state: { totalCost: 0.2 },
    });
    expect(mocks.assertCanUseOperationAgent).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-parent', userId: 'user-1', workspaceId: 'ws-1' }),
    );
    expect(mocks.controlCompletedToolResult).toHaveBeenCalledWith({
      operationId: 'op-parent',
      preserveUsage: true,
      result: { ...input.result, error: undefined },
      toolMessageId: 'msg-tool',
    });
  });

  it('does not review a result for an operation the caller cannot use', async () => {
    mocks.assertCanUseOperationAgent.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(caller.controlClientSubAgentToolResult(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.controlCompletedToolResult).not.toHaveBeenCalled();
  });
});
