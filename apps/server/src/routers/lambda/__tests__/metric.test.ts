// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});

const mockModel = {
  addPoint: vi.fn(),
  delete: vi.fn(),
  ensure: vi.fn(),
  findById: vi.fn(),
  findBySubject: vi.fn(),
  latestPoint: vi.fn(),
  listPoints: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/database/models/metric', () => ({
  MetricModel: vi.fn(() => mockModel),
}));

const mockGoalFindById = vi.fn();
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(() => ({ findById: mockGoalFindById })),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({ existsById: vi.fn().mockResolvedValue(false) })),
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(() => ({ findById: vi.fn().mockResolvedValue(null) })),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({ findById: vi.fn().mockResolvedValue(null) })),
}));

const { metricRouter } = await import('../metric');

describe('metricRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' };
  const caller = metricRouter.createCaller(ctx);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addPoint', () => {
    it('stamps user attribution server-side and defaults observedAt to now', async () => {
      mockModel.addPoint.mockResolvedValue({ id: 'p1' });

      await caller.addPoint({ id: 'mtr_1', value: 42 });

      expect(mockModel.addPoint).toHaveBeenCalledWith('mtr_1', {
        actorId: 'user-1',
        actorType: 'user',
        metadata: undefined,
        observedAt: expect.any(Date),
        sourceType: 'manual',
        value: 42,
      });
    });

    it('maps an unknown series to NOT_FOUND', async () => {
      mockModel.addPoint.mockResolvedValue(undefined);
      await expect(caller.addPoint({ id: 'mtr_missing', value: 1 })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('listPoints', () => {
    it('composes the chart contract from the series definition', async () => {
      mockModel.listPoints.mockResolvedValue({
        points: [{ observedAt: new Date('2026-09-01'), value: 10 }],
        series: {
          config: { target: 100 },
          id: 'mtr_1',
          kind: 'counter',
          title: 'Posts',
          unit: 'count',
        },
      });

      const result = await caller.listPoints({ bucket: 'day', id: 'mtr_1' });

      expect(mockModel.listPoints).toHaveBeenCalledWith('mtr_1', {
        bucket: 'day',
        from: undefined,
        limit: undefined,
        to: undefined,
      });
      expect(result.data).toEqual({
        config: { target: 100 },
        kind: 'counter',
        points: [{ observedAt: new Date('2026-09-01'), value: 10 }],
        title: 'Posts',
        unit: 'count',
      });
    });
  });

  describe('upsertSeries', () => {
    it('rejects a subject the caller cannot see before touching the slot', async () => {
      mockGoalFindById.mockResolvedValue(undefined);

      await expect(
        caller.upsertSeries({ key: 'k', subjectId: 'goal_foreign', subjectType: 'goal' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockModel.ensure).not.toHaveBeenCalled();
    });

    it('maps a foreign-owned slot to CONFLICT', async () => {
      mockGoalFindById.mockResolvedValue({ id: 'goal_1' });
      mockModel.ensure.mockResolvedValue(undefined);
      await expect(
        caller.upsertSeries({ key: 'k', subjectId: 'goal_1', subjectType: 'goal' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('workspace creator scope', () => {
    it.each([
      ['updateSeries', () => caller.updateSeries({ id: 'mtr_1', title: 'hijack' })],
      ['deleteSeries', () => caller.deleteSeries({ id: 'mtr_1' })],
    ])('%s refuses a non-owner member mutating a coworker series', async (_name, run) => {
      // Workspace visibility lets the member *read* the series; mutating a row
      // another member created stays FORBIDDEN without the owner role.
      mockModel.findById.mockResolvedValue({ id: 'mtr_1', userId: 'coworker' });

      await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockModel.update).not.toHaveBeenCalled();
      expect(mockModel.delete).not.toHaveBeenCalled();
    });

    it('deleteSeries surfaces NOT_FOUND when nothing was deleted', async () => {
      mockModel.findById.mockResolvedValue({ id: 'mtr_1', userId: 'user-1' });
      mockModel.delete.mockResolvedValue(undefined);

      await expect(caller.deleteSeries({ id: 'mtr_1' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
