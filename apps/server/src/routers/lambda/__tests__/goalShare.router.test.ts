// @vitest-environment node
import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockGoalFindById = vi.fn();
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findById: mockGoalFindById };
  }),
}));

const mockGraph = vi.fn();
vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(function () {
    return { graph: mockGraph };
  }),
}));

const mockShareCreate = vi.fn();
const mockShareGetByGoalId = vi.fn();
const mockShareUpdateVisibility = vi.fn();
const mockShareDeleteByGoalId = vi.fn();
const mockFindWithAccessCheck = vi.fn();
const mockIncrementViewCount = vi.fn();
vi.mock('@/database/models/goalShare', () => ({
  GoalShareModel: Object.assign(
    vi.fn(function () {
      return {
        create: mockShareCreate,
        deleteByGoalId: mockShareDeleteByGoalId,
        getByGoalId: mockShareGetByGoalId,
        updateVisibility: mockShareUpdateVisibility,
      };
    }),
    {
      findByShareIdWithAccessCheck: (...args: unknown[]) => mockFindWithAccessCheck(...args),
      incrementViewCount: (...args: unknown[]) => mockIncrementViewCount(...args),
    },
  ),
}));

const mockLoadRounds = vi.fn();
vi.mock('@/server/services/verify', () => ({
  AcceptanceService: vi.fn(function () {
    return { loadRounds: mockLoadRounds };
  }),
  buildAcceptanceCheckUnion: (rounds: { results: any[] }[]) =>
    rounds.flatMap((round) =>
      round.results.map((result) => ({
        result,
        state: result.verdict,
        title: result.checkItemTitle,
      })),
    ),
}));

const { goalShareRouter } = await import('../goalShare');

const creatorId = 'user-creator';
const memberId = 'user-member';
const workspaceId = 'ws-1';
const goalId = 'goal-1';

const baseGraph = () => ({
  acceptances: { node_acc: { id: 'acc-1', status: 'accepted' } },
  assignees: { node_acc: 'agt_assignee' },
  decisions: [{ id: 'dec', question: 'internal question' }],
  edges: [],
  events: [{ id: 'evt', operationId: 'op_secret' }],
  goal: {
    config: { budget: 5 },
    id: goalId,
    requirement: 'Ship it',
    status: 'achieved',
    title: 'The goal',
    topicId: 'tpc_secret',
    userId: creatorId,
  },
  nodes: [
    {
      createdAt: new Date(0),
      id: 'node_acc',
      kind: 'task',
      status: 'resolved',
      taskId: 'task_secret',
      title: GOAL_ACCEPTANCE_TASK_TITLE,
    },
  ],
  report: {
    dispatch: { operationId: 'op_leak' },
    latest: {
      metadata: {
        chapters: [{ detours: [], findingIds: [], narrative: 'Story', nodeIds: [], title: 'One' }],
        graphCursor: 'cursor',
        headline: 'Done',
        nextSteps: [],
      },
    },
    status: 'completed',
  },
  runHeartbeats: {},
  spend: { totalCost: 4 },
  workVersions: [],
});

describe('goalShare router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoalFindById.mockResolvedValue({ id: goalId, userId: creatorId });
    mockGraph.mockResolvedValue(baseGraph());
    mockShareGetByGoalId.mockResolvedValue(null);
    mockShareCreate.mockResolvedValue({ goalId, id: 'share-1', visibility: 'private' });
    mockShareUpdateVisibility.mockResolvedValue({ goalId, id: 'share-1', visibility: 'link' });
    mockIncrementViewCount.mockResolvedValue(undefined);
    mockLoadRounds.mockResolvedValue({
      results: [
        {
          checkItemTitle: 'Report is readable',
          toulmin: { reasoning: 'Read end to end' },
          verdict: 'passed',
          verifyRunId: 'run-1',
        },
      ],
      runs: [{ id: 'run-1' }],
    });
  });

  describe('enable', () => {
    it('creates the share for the goal creator', async () => {
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      const result = await caller.enable({ goalId, visibility: 'link' });

      expect(mockShareCreate).toHaveBeenCalledWith(goalId, 'link');
      expect(mockShareUpdateVisibility).toHaveBeenCalledWith(goalId, 'link');
      expect(result.data).toMatchObject({ visibility: 'link' });
    });

    it('refuses with a clear error when the goal has no report.latest', async () => {
      mockGraph.mockResolvedValue({ ...baseGraph(), report: undefined });
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      await expect(caller.enable({ goalId })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: expect.stringContaining('no wrap-up report'),
      });
      expect(mockShareCreate).not.toHaveBeenCalled();
    });

    it('refuses while the report is still being written', async () => {
      mockGraph.mockResolvedValue({
        ...baseGraph(),
        report: { dispatch: {}, status: 'running' },
      });
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      await expect(caller.enable({ goalId })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });

    it('reads a goal outside the caller scope as NOT_FOUND', async () => {
      mockGoalFindById.mockResolvedValue(undefined);
      const caller = goalShareRouter.createCaller({ userId: memberId } as any);

      await expect(caller.enable({ goalId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockShareCreate).not.toHaveBeenCalled();
    });

    it('rejects a workspace member who did not create the goal', async () => {
      const caller = goalShareRouter.createCaller({
        userId: memberId,
        workspaceId,
        workspaceRole: 'member',
      } as any);

      await expect(caller.enable({ goalId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockShareCreate).not.toHaveBeenCalled();
    });

    it('allows a workspace owner to manage a goal someone else created', async () => {
      const caller = goalShareRouter.createCaller({
        userId: memberId,
        workspaceId,
        workspaceRole: 'owner',
      } as any);

      await caller.enable({ goalId });

      expect(mockShareCreate).toHaveBeenCalledWith(goalId, 'private');
    });
  });

  describe('setVisibility / disable / getInfo', () => {
    it('updates the visibility', async () => {
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      const result = await caller.setVisibility({ goalId, visibility: 'link' });

      expect(mockShareUpdateVisibility).toHaveBeenCalledWith(goalId, 'link');
      expect(result.data).toMatchObject({ visibility: 'link' });
    });

    it('reports NOT_FOUND when updating a goal that was never shared', async () => {
      mockShareUpdateVisibility.mockResolvedValue(null);
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      await expect(caller.setVisibility({ goalId, visibility: 'link' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('deletes the share', async () => {
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      await caller.disable({ goalId });

      expect(mockShareDeleteByGoalId).toHaveBeenCalledWith(goalId);
    });

    it('rejects disabling by a non-creator workspace member', async () => {
      const caller = goalShareRouter.createCaller({ userId: memberId, workspaceId } as any);

      await expect(caller.disable({ goalId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockShareDeleteByGoalId).not.toHaveBeenCalled();
    });

    it('returns the share record, or null when not shared', async () => {
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);
      expect((await caller.getInfo({ goalId })).data).toBeNull();

      mockShareGetByGoalId.mockResolvedValue({ goalId, id: 'share-1', visibility: 'link' });
      expect((await caller.getInfo({ goalId })).data).toMatchObject({ id: 'share-1' });
    });
  });

  describe('getSharedGoal', () => {
    const share = {
      goalId,
      ownerId: creatorId,
      shareId: 'share-1',
      visibility: 'link',
      workspaceId: null,
    };

    it('returns the redacted view to an anonymous visitor', async () => {
      mockFindWithAccessCheck.mockResolvedValue(share);
      const caller = goalShareRouter.createCaller({} as any);

      const { data } = await caller.getSharedGoal({ shareId: 'share-1' });

      expect(mockFindWithAccessCheck).toHaveBeenCalledWith(expect.anything(), 'share-1', undefined);
      expect(data.goal).toEqual({
        requirement: 'Ship it',
        status: 'achieved',
        title: 'The goal',
      });
      expect(data.report?.headline).toBe('Done');
      expect(data.acceptance).toEqual({
        checks: [
          {
            passed: true,
            state: 'passed',
            summary: 'Read end to end',
            title: 'Report is readable',
          },
        ],
        status: 'accepted',
      });
      expect(data.isOwner).toBe(false);
      expect(mockIncrementViewCount).toHaveBeenCalledWith(expect.anything(), 'share-1');

      const json = JSON.stringify(data);
      for (const leaked of [
        creatorId,
        'tpc_secret',
        'task_secret',
        'op_leak',
        'op_secret',
        'agt_assignee',
        'internal question',
        'cursor',
        'acc-1',
      ]) {
        expect(json, leaked).not.toContain(leaked);
      }
      for (const key of ['spend', 'config', 'events', 'decisions', 'assignees', 'runHeartbeats']) {
        expect(data, key).not.toHaveProperty(key);
      }
    });

    it('reads the goal as the share owner, not the visitor', async () => {
      mockFindWithAccessCheck.mockResolvedValue({ ...share, workspaceId });
      const { GoalService } = await import('@/server/services/goal');
      const { AcceptanceService } = await import('@/server/services/verify');
      const caller = goalShareRouter.createCaller({ userId: 'someone-else' } as any);

      await caller.getSharedGoal({ shareId: 'share-1' });

      expect(GoalService).toHaveBeenCalledWith(expect.anything(), creatorId, workspaceId);
      expect(AcceptanceService).toHaveBeenCalledWith(expect.anything(), creatorId, workspaceId);
    });

    it('does not count the owner viewing their own share', async () => {
      mockFindWithAccessCheck.mockResolvedValue(share);
      const caller = goalShareRouter.createCaller({ userId: creatorId } as any);

      const { data } = await caller.getSharedGoal({ shareId: 'share-1' });

      expect(data.isOwner).toBe(true);
      expect(mockIncrementViewCount).not.toHaveBeenCalled();
    });

    it('propagates the access check refusal for a private share', async () => {
      const { TRPCError } = await import('@trpc/server');
      mockFindWithAccessCheck.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' }),
      );
      const caller = goalShareRouter.createCaller({} as any);

      await expect(caller.getSharedGoal({ shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockGraph).not.toHaveBeenCalled();
    });
  });
});
