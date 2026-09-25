import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  refreshTaskDetail: vi.fn(),
  update: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: vi.fn(),
}));

vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  getWorkspaceMembers: vi.fn(),
}));

vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));

vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: {} }));

vi.mock('@/store/chat', () => ({ getChatStoreState: vi.fn() }));

vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ internal_refreshTaskDetail: mocks.refreshTaskDetail }),
}));

vi.mock('@/store/task/slices/detail/reducer', () => ({
  findSubtaskParentId: vi.fn(() => undefined),
}));

vi.mock('@/services/task', () => ({
  taskService: {
    getDetail: mocks.getDetail,
    update: mocks.update,
    updateConfig: mocks.updateConfig,
  },
}));

const { taskExecutor } = await import('./index');

describe('TaskExecutor — setTaskSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T00:00:00Z'));
    mocks.update.mockResolvedValue(undefined);
    mocks.updateConfig.mockResolvedValue(undefined);
    mocks.refreshTaskDetail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the next runs after setting a schedule, like the server runtime', async () => {
    const result = await taskExecutor.setTaskSchedule({
      automationMode: 'schedule',
      identifier: 'T-1',
      schedulePattern: '30 9 * * 1-5',
      scheduleTimezone: 'Asia/Shanghai',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      'next runs (Asia/Shanghai) → Mon 2026-09-28 09:30; Tue 2026-09-29 09:30; Wed 2026-09-30 09:30',
    );
    expect(mocks.getDetail).not.toHaveBeenCalled();
  });

  it('fills a field the call left out from the stored schedule', async () => {
    mocks.getDetail.mockResolvedValue({
      data: { schedule: { pattern: '0 10 27 9 *', timezone: 'Asia/Shanghai' } },
    });

    const result = await taskExecutor.setTaskSchedule({
      identifier: 'T-1',
      scheduleTimezone: 'Asia/Shanghai',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('next runs (Asia/Shanghai) → Sun 2026-09-27 10:00');
  });

  it('refuses an unusable pattern without writing anything', async () => {
    const result = await taskExecutor.setTaskSchedule({
      identifier: 'T-1',
      maxExecutions: 1,
      schedulePattern: '0 0 9 * * *',
    });

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/^Invalid schedule for task T-1: expected 5 fields/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it('does not add a preview when the schedule is untouched', async () => {
    const result = await taskExecutor.setTaskSchedule({ identifier: 'T-1', maxExecutions: 3 });

    expect(result.success).toBe(true);
    expect(result.content).not.toContain('next runs');
    expect(mocks.getDetail).not.toHaveBeenCalled();
  });
});
