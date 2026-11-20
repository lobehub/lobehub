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
vi.mock('@/database/models/goalMark', () => ({
  GoalMarkModel: vi.fn(function () {
    return { findRunNode: mockRunNode };
  }),
}));

const mockRecord = vi.fn();
const mockLeaderboard = vi.fn();
vi.mock('@/server/services/goal/objective', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GoalObjectiveService: vi.fn(function () {
    return { leaderboard: mockLeaderboard, recordEvaluation: mockRecord };
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

describe('goalRouter objective for a Goal Task run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ operationId: 'op_1', userId: 'user-1', workspaceId: 'ws-1' });
    mockRunNode.mockResolvedValue({
      agentId: 'agt_1',
      goalId: 'goal_1',
      nodeId: 'node_1',
      taskId: 'task_1',
    });
    mockRecord.mockResolvedValue({ lane: 'node_1', recorded: true });
    mockLeaderboard.mockResolvedValue({ lanes: [] });
  });

  it('refuses an ordinary user token', async () => {
    await expect(
      caller('user').recordEvaluationOperation({ score: 1, valid: true }),
    ).rejects.toThrow('An operation-bound token is required');
  });

  it('records the evaluation for the token’s own run, with its operation', async () => {
    await caller('operation').recordEvaluationOperation({
      fingerprint: 'abc',
      score: 37.5,
      valid: true,
    });

    expect(mockRecord).toHaveBeenCalledWith(
      'goal_1',
      { fingerprint: 'abc', score: 37.5, valid: true },
      { agentId: 'agt_1', nodeId: 'node_1', operationId: 'op_1', taskId: 'task_1' },
    );
  });

  it('reads the leaderboard naming the run’s lane', async () => {
    const result = await caller('operation').objectiveOperation();

    expect(mockLeaderboard).toHaveBeenCalledWith('goal_1', 'node_1');
    expect(result).toMatchObject({ data: { lanes: [] }, goalId: 'goal_1' });
  });

  it('rejects a score that is not a finite number before recording', async () => {
    await expect(
      caller('operation').recordEvaluationOperation({ score: Number.NaN, valid: true }),
    ).rejects.toThrow();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
