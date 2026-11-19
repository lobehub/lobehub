// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heteroRouter } from './hetero';

const mocks = vi.hoisted(() => ({
  assertCanUseOperationAgent: vi.fn(),
  operation: undefined as Record<string, unknown> | undefined,
  submitHeteroInterventionAs: vi.fn(),
}));

vi.mock('./heteroInterventionSubmit', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  submitHeteroInterventionAs: mocks.submitHeteroInterventionAs,
}));
vi.mock('./guards', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertCanUseOperationAgent: mocks.assertCanUseOperationAgent,
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

const caller = heteroRouter.createCaller({ userId: 'user-1', workspaceId: 'ws-1' } as never);
const answer = (toolCallId: string) =>
  caller.submitHeteroIntervention({
    operationId: 'op-1',
    result: { q: 'allow' },
    toolCallId,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.operation = { userId: 'user-1' };
  mocks.submitHeteroInterventionAs.mockResolvedValue({ status: 'resolving', success: true });
});

describe('aiAgent.submitHeteroIntervention — Claude Code permission cards', () => {
  it('lets the run owner answer a permission card', async () => {
    await expect(answer('cc-permission-req-1')).resolves.toMatchObject({ success: true });
    expect(mocks.submitHeteroInterventionAs).toHaveBeenCalled();
  });

  it("refuses a teammate approving an action on someone else's run", async () => {
    // The teammate may use the shared agent, but did not start this run.
    mocks.operation = { userId: 'user-2' };
    await expect(answer('cc-permission-req-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.submitHeteroInterventionAs).not.toHaveBeenCalled();
  });

  it('leaves question cards on the agent-use check', async () => {
    mocks.operation = { userId: 'user-2' };
    await expect(answer('toolu_question')).resolves.toMatchObject({ success: true });
    expect(mocks.assertCanUseOperationAgent).toHaveBeenCalled();
  });
});
