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

const mockRunNode = vi.fn();
const mockAdd = vi.fn();
const mockJudge = vi.fn();
vi.mock('@/database/models/goalMark', () => ({
  GoalMarkModel: vi.fn(function () {
    return { findRunNode: mockRunNode };
  }),
}));
vi.mock('@/server/services/goal/marks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GoalMarkService: vi.fn(function () {
    return { add: mockAdd, judge: mockJudge };
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

const markId = '11111111-1111-4111-8111-111111111111';

describe('goalRouter marks for a Goal Task run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ operationId: 'op_1', userId: 'user-1', workspaceId: 'ws-1' });
    mockRunNode.mockResolvedValue({ agentId: 'agt_1', goalId: 'goal_1', nodeId: 'node_1' });
    mockAdd.mockResolvedValue({ id: markId });
  });

  it('refuses an ordinary user token', async () => {
    await expect(
      caller('user').addMarkOperation({ kind: 'pattern', title: 'fix' }),
    ).rejects.toThrow('An operation-bound token is required');
  });

  it('marks the goal of the token’s own run, authored by that run', async () => {
    await caller('operation').addMarkOperation({ kind: 'hazard', title: 'Do not touch index.ts' });

    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'hetero:ingest', operationId: 'op_1' }),
    );
    expect(mockRunNode).toHaveBeenCalledWith('op_1');
    expect(mockAdd).toHaveBeenCalledWith(
      'goal_1',
      { kind: 'hazard', title: 'Do not touch index.ts' },
      { agentId: 'agt_1', nodeId: 'node_1' },
    );
  });

  it('refuses a run that works for no Goal Task, before writing anything', async () => {
    mockRunNode.mockResolvedValue(undefined);

    await expect(
      caller('operation').judgeMarkOperation({ markId, verdict: 'confirms' }),
    ).rejects.toThrow('does not work for a Goal Task');
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it('rejects a kind that is not a mark', async () => {
    await expect(
      caller('operation').addMarkOperation({ kind: 'finding' as never, title: 'x' }),
    ).rejects.toThrow();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
