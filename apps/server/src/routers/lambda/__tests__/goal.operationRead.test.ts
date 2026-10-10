// @vitest-environment node
import { TRPCError } from '@trpc/server';
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
const mockAssertOwnsTurn = vi.fn();
vi.mock('@/server/services/goal/manager', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GoalManagerService: vi.fn(function () {
    return { admission: mockAdmission, assertOperationOwnsTurn: mockAssertOwnsTurn };
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
    // The guard resolves the Goal's current turn itself; mocks only its wiring.
    mockAssertOwnsTurn.mockResolvedValue(undefined);
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

  it('refuses a Goal whose current turn belongs to another operation', async () => {
    // A `hetero:ingest` token is held by runs that never plan, so holding one must
    // not let a run read a Goal it does not own — least of all the manager state
    // and planning token `planContext` returns.
    const refusal = new TRPCError({
      code: 'FORBIDDEN',
      message: 'This run does not own the current planning turn of this goal',
    });
    mockAssertOwnsTurn.mockRejectedValue(refusal);

    await expect(caller('operation').graphOperation({ id: 'goal_2' })).rejects.toThrow(
      'does not own',
    );
    await expect(caller('operation').planContextOperation({ id: 'goal_2' })).rejects.toThrow(
      'does not own',
    );
    await expect(caller('operation').eventsOperation({ id: 'goal_2' })).rejects.toThrow(
      'does not own',
    );

    // Refused before touching the Goal's graph, manager state or audit trail.
    expect(mockGraph).not.toHaveBeenCalled();
    expect(mockAdmission).not.toHaveBeenCalled();
    // Every read asked the same question, of the Goal it was handed.
    expect(mockAssertOwnsTurn.mock.calls).toEqual([
      ['goal_2', 'op_1'],
      ['goal_2', 'op_1'],
      ['goal_2', 'op_1'],
    ]);
  });

  it('refuses an operation read of a Goal it cannot see', async () => {
    mockAssertOwnsTurn.mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' }),
    );

    await expect(caller('operation').graphOperation({ id: 'goal-missing' })).rejects.toThrow(
      'Goal not found',
    );
  });
});
