import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchTaskDetail: vi.fn() }));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: vi.fn(() => undefined),
}));
vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  getWorkspaceMembers: vi.fn(() => []),
}));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { displayUserName: () => '', userId: () => undefined },
}));
vi.mock('@/store/chat', () => ({ getChatStoreState: vi.fn() }));
vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ fetchTaskDetail: mocks.fetchTaskDetail }),
}));
vi.mock('@/store/task/slices/detail/reducer', () => ({
  findSubtaskParentId: vi.fn(() => undefined),
}));
vi.mock('@/services/task', () => ({ taskService: { find: vi.fn() } }));

const { taskExecutor } = await import('./index');

const body = ['## 去重台账', '- #101 已处理', `- ${'z'.repeat(1500)}`].join('\n');

describe('TaskExecutor — viewTask comment bodies', () => {
  beforeEach(() => {
    mocks.fetchTaskDetail.mockResolvedValue({
      activities: [
        {
          author: { id: 'user_1', name: 'Arvin', type: 'user' },
          content: body,
          id: 'cmt_v6',
          time: '2026-11-04T01:02:00.000Z',
          type: 'comment',
        },
      ],
      id: 'task_1',
      identifier: 'T-2670',
      instruction: 'patrol',
      status: 'running',
    });
  });

  it('lists comment bodies in Activities and returns a full comment by commentId', async () => {
    const overview = await taskExecutor.viewTask({ identifier: 'T-2670' });
    expect(overview.content).toContain('👤 user Arvin  cmt_v6');
    expect(overview.content).toContain('      - #101 已处理');

    const full = await taskExecutor.viewTask({ commentId: 'cmt_v6', identifier: 'T-2670' });
    expect(full).toMatchObject({
      state: { identifier: 'T-2670', taskId: 'task_1' },
      success: true,
    });
    expect(full.content).toContain(body);
  });

  it('fails with the missing comment id instead of returning the overview', async () => {
    const result = await taskExecutor.viewTask({ commentId: 'cmt_missing', identifier: 'T-2670' });
    expect(result).toMatchObject({ success: false });
    expect(result.content).toContain('Comment not found on T-2670: cmt_missing');
  });
});
