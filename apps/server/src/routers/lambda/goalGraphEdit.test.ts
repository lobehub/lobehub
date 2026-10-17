// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { ...(await importOriginal<object>()), wsCompatProcedure: authedProcedure };
});

vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/goal', () => ({ GoalService: vi.fn() }));

const mockFindById = vi.fn();
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findById: mockFindById };
  }),
}));

const mockRemoveDraftEdges = vi.fn();
vi.mock('@/database/models/goalGraph', () => ({
  GoalGraphModel: vi.fn(function () {
    return { removeDraftEdges: mockRemoveDraftEdges };
  }),
}));

const { router } = await import('@/libs/trpc/lambda');
const { goalGraphEditProcedures } = await import('./goalGraphEdit');

const source = '00000000-0000-4000-8000-000000000001';
const target = '00000000-0000-4000-8000-000000000002';

describe('goalGraphEditProcedures.removeEdge', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: null };
  const caller = router(goalGraphEditProcedures).createCaller(ctx);

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'user-1' });
  });

  it('removes the matching edges of a draft', async () => {
    mockRemoveDraftEdges.mockResolvedValue({ edgeIds: ['edge-1'], status: 'removed' });

    const result = await caller.removeEdge({
      id: 'goal_1',
      kind: 'depends_on',
      sourceNodeId: source,
      targetNodeId: target,
    });

    expect(mockRemoveDraftEdges).toHaveBeenCalledWith(
      'goal_1',
      { kind: 'depends_on', sourceNodeId: source, targetNodeId: target },
      undefined,
    );
    expect(result).toMatchObject({ data: { edgeIds: ['edge-1'] }, success: true });
  });

  it('refuses a started goal with the reason', async () => {
    mockRemoveDraftEdges.mockResolvedValue({ goalStatus: 'running', status: 'not_draft' });

    await expect(
      caller.removeEdge({ id: 'goal_1', sourceNodeId: source, targetNodeId: target }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Only a draft Goal can remove edges; this one is running',
    });
  });

  it('says so when no edge matched', async () => {
    mockRemoveDraftEdges.mockResolvedValue({ edgeIds: [], status: 'removed' });

    await expect(
      caller.removeEdge({
        id: 'goal_1',
        kind: 'depends_on',
        sourceNodeId: source,
        targetNodeId: target,
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: `No depends_on edge from ${source} to ${target}`,
    });
  });

  it("refuses a workspace member editing a colleague's goal", async () => {
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'colleague' });
    const memberCaller = router(goalGraphEditProcedures).createCaller({
      ...ctx,
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    });

    await expect(
      memberCaller.removeEdge({ id: 'goal_1', sourceNodeId: source, targetNodeId: target }),
    ).rejects.toThrow(/Only the creator or a workspace owner/);
    expect(mockRemoveDraftEdges).not.toHaveBeenCalled();
  });
});
