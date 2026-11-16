import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tfsGitRouter } from './tfsGit';

const mocks = vi.hoisted(() => ({ principal: vi.fn(), run: vi.fn() }));
interface Context {
  heteroAuthKind?: string;
  heteroOperation?: { operation_id: string };
  serverDB: never;
  userId: string;
  workspaceId?: string;
}
const { t } = await vi.hoisted(async () => {
  const { initTRPC } = await import('@trpc/server');
  return { t: initTRPC.create() };
});
vi.mock('@/libs/trpc/lambda', () => ({
  heteroAuthedProcedure: t.procedure,
  router: t.router,
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', () => ({
  wsCompatProcedure: t.procedure,
}));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: t.middleware(({ next }) => next()),
}));
vi.mock('@/server/services/tfs/git', () => ({ runTfsGit: mocks.run }));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', () => ({
  resolveActiveHeteroOperationPrincipal: mocks.principal,
  HeteroOperationPrincipalError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

const context: Context = {
  heteroAuthKind: 'operation',
  heteroOperation: { operation_id: 'op' },
  serverDB: {} as never,
  userId: 'request-context-user',
};

describe('operation-bound TFS Git endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.principal.mockResolvedValue({
      userId: 'requester',
      workspaceId: 'ws',
      topicId: 'own-topic',
      operationId: 'op',
    });
    mocks.run.mockResolvedValue({ success: true });
  });

  it('binds the operation to its durable requester and topic', async () => {
    await tfsGitRouter.createCaller(context).gitOperation({ operation: 'fetch' });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'requester', workspaceId: 'ws', operationId: 'op' }),
      { operation: 'fetch', sourceIndex: 0, topicId: 'own-topic' },
    );
  });

  it('cannot redirect an operation to a supplied topic or user', async () => {
    await tfsGitRouter.createCaller(context).gitOperation({
      operation: 'push',
      branch: 'main',
      topicId: 'other',
      userId: 'owner',
    } as never);
    expect(mocks.run.mock.calls[0][1].topicId).toBe('own-topic');
    expect(mocks.run.mock.calls[0][0].userId).toBe('requester');
  });

  it('rejects expired or revoked operations before executing Git', async () => {
    mocks.principal.mockRejectedValue(new Error('Operation has already ended'));
    await expect(
      tfsGitRouter.createCaller(context).gitOperation({ operation: 'fetch' }),
    ).rejects.toThrow('Operation has already ended');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('requires an operation principal and a valid branch', async () => {
    await expect(
      tfsGitRouter
        .createCaller({ ...context, heteroAuthKind: 'user' })
        .gitOperation({ operation: 'fetch' }),
    ).rejects.toThrow('active operation');
    await expect(
      tfsGitRouter.createCaller(context).gitOperation({ operation: 'push', branch: 'main:other' }),
    ).rejects.toThrow('Invalid branch');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
