// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heteroRouter } from './hetero';

const mocks = vi.hoisted(() => ({
  operation: undefined as Record<string, unknown> | undefined,
  setHeteroPermissionMode: vi.fn(),
}));

vi.mock('@/server/services/aiAgent/steerQueue/heteroPermissionMode', () => ({
  setHeteroPermissionMode: mocks.setHeteroPermissionMode,
}));
vi.mock('./procedures', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const serverDB = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (mocks.operation ? [mocks.operation] : []) }),
      }),
    }),
  };
  const procedure = trpc.procedure.use((opts) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: serverDB as never } }),
  );
  return {
    aiAgentBaseProcedure: procedure,
    aiAgentWriteProcedure: procedure,
    heteroAgentProcedure: procedure,
  };
});

const caller = heteroRouter.createCaller({ userId: 'user-1' } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.operation = { agentId: 'agent-1', userId: 'user-1' };
  mocks.setHeteroPermissionMode.mockResolvedValue({ status: 'accepted' });
});

describe('aiAgent.setHeteroPermissionMode', () => {
  it('switches the running Claude Code over its control channel', async () => {
    await expect(
      caller.setHeteroPermissionMode({ mode: 'acceptEdits', operationId: 'op-1' }),
    ).resolves.toEqual({ status: 'accepted' });
    expect(mocks.setHeteroPermissionMode).toHaveBeenCalledWith('op-1', 'acceptEdits');
  });

  it("refuses a mode it does not offer and another user's run", async () => {
    await expect(
      caller.setHeteroPermissionMode({ mode: 'dontAsk' as never, operationId: 'op-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    mocks.operation = { agentId: 'agent-1', userId: 'user-2' };
    await expect(
      caller.setHeteroPermissionMode({ mode: 'plan', operationId: 'op-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.setHeteroPermissionMode).not.toHaveBeenCalled();
  });
});
