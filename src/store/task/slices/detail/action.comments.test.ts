import type { TaskDetailActivity } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { taskService } from '@/services/task';
import { useUserStore } from '@/store/user';

import { useTaskStore } from '../../store';

vi.mock('@/services/task', () => ({ taskService: { addComment: vi.fn() } }));
vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

const root: TaskDetailActivity = { content: 'root body', id: 'root', type: 'comment' };
const existing: TaskDetailActivity = {
  content: 'existing reply',
  id: 'existing',
  parentCommentId: 'root',
  type: 'comment',
};

beforeEach(() => {
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
  vi.mocked(taskService.addComment).mockReset();
  useUserStore.setState({
    isSignedIn: true,
    user: { avatar: null, fullName: 'Me', id: 'user_me' } as never,
  });
  useTaskStore.setState({
    activeTaskId: 'task',
    taskDetailMap: {
      task: { activities: [root, existing], id: 'task', identifier: 'T-1', status: 'backlog' },
    },
    taskDetailReplica: createReplicaState(),
    taskRefIndex: { task: 'task' },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('task comment threads', () => {
  it('links the optimistic reply to its root and preserves the original activities', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    vi.mocked(taskService.addComment).mockImplementation(async () => {
      await promise;
      return { data: { id: 'saved' }, success: true } as never;
    });
    const request = useTaskStore
      .getState()
      .addComment('task', 'reply', { parentCommentId: 'root' });
    const activities = useTaskStore.getState().taskDetailMap.task.activities!;

    expect(activities.slice(0, 2)).toEqual([root, existing]);
    expect(activities[2]).toMatchObject({
      content: 'reply',
      parentCommentId: 'root',
      type: 'comment',
    });
    resolve();
    await request;
    expect(taskService.addComment).toHaveBeenCalledWith('task', 'reply', {
      parentCommentId: 'root',
    });
  });

  it('keeps a saved reply successful when refreshing the detail fails', async () => {
    const saved = { data: { id: 'saved-reply', parentCommentId: 'root' }, success: true };
    vi.mocked(taskService.addComment).mockResolvedValue(saved as never);
    vi.mocked(mutate).mockRejectedValue(new Error('detail temporarily unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      useTaskStore.getState().addComment('task', 'saved reply', { parentCommentId: 'root' }),
    ).resolves.toBe(saved);
    expect(useTaskStore.getState().taskDetailMap.task.activities).toEqual([
      root,
      existing,
      expect.objectContaining({ content: 'saved reply', parentCommentId: 'root' }),
    ]);
  });

  it('rolls back only the failed reply while retaining other replies added in flight', async () => {
    const { promise, reject } = Promise.withResolvers<never>();
    vi.mocked(taskService.addComment).mockReturnValue(promise);
    const request = useTaskStore
      .getState()
      .addComment('task', 'failed reply', { parentCommentId: 'root' });
    const concurrent: TaskDetailActivity = {
      content: 'concurrent',
      id: 'concurrent',
      parentCommentId: 'root',
      type: 'comment',
    };
    const detail = useTaskStore.getState().taskDetailMap.task;
    useTaskStore.setState({
      taskDetailMap: { task: { ...detail, activities: [...detail.activities!, concurrent] } },
    });
    vi.mocked(mutate).mockRejectedValue(new Error('offline'));
    reject(new Error('failed'));

    await expect(request).rejects.toThrow('failed');
    expect(useTaskStore.getState().taskDetailMap.task.activities).toEqual([
      root,
      existing,
      concurrent,
    ]);
  });

  it('does not refresh or roll back into a different workspace after sending', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    vi.mocked(taskService.addComment).mockImplementation(async () => {
      await promise;
      return { data: { id: 'saved' }, success: true } as never;
    });
    const scope = vi.spyOn(cacheScope, 'get').mockReturnValue('original');
    const request = useTaskStore
      .getState()
      .addComment('task', 'reply', { parentCommentId: 'root' });
    scope.mockReturnValue('next-workspace');
    vi.mocked(mutate).mockClear();
    resolve();
    await request;

    expect(mutate).not.toHaveBeenCalled();
  });
});
