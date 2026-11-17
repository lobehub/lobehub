// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heteroRouter } from './hetero';

const mocks = vi.hoisted(() => ({
  operation: undefined as Record<string, unknown> | undefined,
  stopHeteroBackgroundTask: vi.fn(),
}));

vi.mock('@/server/services/aiAgent/steerQueue/heteroStopTask', () => ({
  stopHeteroBackgroundTask: mocks.stopHeteroBackgroundTask,
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
  mocks.stopHeteroBackgroundTask.mockResolvedValue({ status: 'accepted' });
});

describe('aiAgent.stopHeteroBackgroundTask', () => {
  it('sends the stop over the run control channel and returns its result', async () => {
    await expect(
      caller.stopHeteroBackgroundTask({ operationId: 'op-1', taskId: 'bys1w0wxo' }),
    ).resolves.toEqual({ status: 'accepted' });
    expect(mocks.stopHeteroBackgroundTask).toHaveBeenCalledWith('op-1', 'bys1w0wxo');
  });

  it('passes through why a device could not stop the task', async () => {
    mocks.stopHeteroBackgroundTask.mockResolvedValue({ status: 'unreachable' });
    await expect(
      caller.stopHeteroBackgroundTask({ operationId: 'op-1', taskId: 'bys1w0wxo' }),
    ).resolves.toEqual({ status: 'unreachable' });
  });

  it("refuses another user's run", async () => {
    mocks.operation = { agentId: 'agent-1', userId: 'user-2' };
    await expect(
      caller.stopHeteroBackgroundTask({ operationId: 'op-1', taskId: 'bys1w0wxo' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    mocks.operation = undefined;
    await expect(
      caller.stopHeteroBackgroundTask({ operationId: 'op-missing', taskId: 'bys1w0wxo' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.stopHeteroBackgroundTask).not.toHaveBeenCalled();
  });
});
