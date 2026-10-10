// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

// The operation token is classified by the real middleware; only the claim
// validator is stubbed, so `heteroAuthKind` is decided the way production does.
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateHeteroOperationClaims: vi.fn((claims: Record<string, unknown> | undefined) =>
    claims?.purpose === 'hetero-operation'
      ? { capabilities: ['hetero:ingest'], operation_id: 'op_1', sub: claims.sub }
      : undefined,
  ),
}));

const mockResolve = vi.fn();
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveActiveHeteroOperationPrincipal: mockResolve,
}));

const mockGraph = vi.fn();
vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(function () {
    return { graph: mockGraph };
  }),
}));

const mockAdmission = vi.fn();
vi.mock('@/server/services/goal/manager', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GoalManagerService: vi.fn(function () {
    return { admission: mockAdmission };
  }),
}));

const { goalRouter } = await import('../goal');

const caller = (authKind: 'operation' | 'user') =>
  goalRouter.createCaller({
    jwtPayload: { userId: 'user-1' },
    oidcAuth: {
      ...(authKind === 'operation' ? { purpose: 'hetero-operation' } : {}),
      sub: 'user-1',
    },
    serverDB: {},
    userId: 'user-1',
  } as never);

describe('goalRouter operation reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ operationId: 'op_1', userId: 'user-1', workspaceId: 'ws-1' });
    mockGraph.mockResolvedValue({ goal: { id: 'goal_1' } });
    mockAdmission.mockResolvedValue({ admission: { code: 'ok', ok: true } });
  });

  it('refuses an ordinary user token — this surface is not a wider read', async () => {
    await expect(caller('user').graphOperation({ id: 'goal_1' })).rejects.toThrow(
      'An operation-bound token is required',
    );
  });

  it('reads under the operation principal, pinned to the token’s own operation', async () => {
    const result = await caller('operation').graphOperation({ id: 'goal_1' });

    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'hetero:ingest', operationId: 'op_1' }),
    );
    expect(mockGraph).toHaveBeenCalledWith('goal_1');
    expect(result.data).toEqual({ goal: { id: 'goal_1' } });
  });

  it('serves the plan context and the audit trail through the same guard', async () => {
    await expect(caller('user').planContextOperation({ id: 'goal_1' })).rejects.toThrow(
      'An operation-bound token is required',
    );

    const context = await caller('operation').planContextOperation({ id: 'goal_1' });
    expect(context.data).toEqual({ admission: { code: 'ok', ok: true } });
    // The turn's own token is not supplied, so the read falls back to the
    // recorded one — an operation may read without resubmitting.
    expect(mockAdmission).toHaveBeenCalledWith('goal_1', {
      operationId: undefined,
      token: undefined,
    });
  });
});
