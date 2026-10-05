import {
  applyTaskReposSelection,
  readTaskExecutionConfig,
  toTaskExecutionConfigPatch,
} from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { workService } from '@/services/work';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';

import { useTaskStore } from '../../store';
import { taskDetailResource } from './projection';
import { taskDetailRefreshes } from './testUtils';

vi.mock('@/services/task', () => ({
  taskService: {
    addComment: vi.fn(),
    addDependency: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    getDetail: vi.fn(),
    pinDocument: vi.fn(),
    removeDependency: vi.fn(),
    reorderSubtasks: vi.fn(),
    unpinDocument: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/services/work', () => ({
  workService: {
    refreshAllConversations: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

beforeEach(() => {
  vi.resetAllMocks();
  useTaskStore.setState({
    activeTaskId: undefined,
    isCreatingTask: false,
    isDeletingTask: false,
    taskDetailMap: {},
    taskDetailReplica: createReplicaState(),
    taskInstructionRevisionMap: {},
    taskSaveStatusMap: {},
  });
});

describe('TaskDetailSliceAction', () => {
  describe('task detail replica', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const syncCall = () =>
      vi
        .mocked(useClientDataSWR)
        .mock.calls.find(([key]) => Array.isArray(key) && key[0] === 'replica:sync');

    it('polls while the task is in flight and stops once it settles', () => {
      vi.mocked(useClientDataSWR).mockReturnValue({ isValidating: false, mutate: vi.fn() } as any);
      useTaskStore.setState({
        taskDetailMap: { 'T-1': { identifier: 'T-1', status: 'running' } as any },
      });

      const { rerender } = renderHook(() => useTaskStore.getState().useFetchTaskDetail('T-1'));
      expect(syncCall()?.[2]).toMatchObject({ refreshInterval: 10_000 });

      vi.mocked(useClientDataSWR).mockClear();
      useTaskStore.setState({
        taskDetailMap: { 'T-1': { identifier: 'T-1', status: 'completed' } as any },
      });
      rerender();
      expect(syncCall()?.[2]).toMatchObject({ refreshInterval: 0 });
    });

    it('drops a cached detail once the server confirms the task is gone', () => {
      vi.mocked(useClientDataSWR).mockReturnValue({ isValidating: false, mutate: vi.fn() } as any);
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': { identifier: 'T-1', status: 'backlog' } as any,
          'T-2': { identifier: 'T-2', status: 'backlog' } as any,
        },
      });
      renderHook(() => {
        useTaskStore.getState().useFetchTaskDetail('T-1');
        useTaskStore.getState().useFetchTaskDetail('T-2');
      });
      const onErrorFor = (id: string) =>
        (
          vi
            .mocked(useClientDataSWR)
            .mock.calls.find(
              ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[4] === id,
            )?.[2] as {
            onError: (error: unknown) => void;
          }
        ).onError;

      onErrorFor('T-1')(
        Object.assign(new Error('Task not found: T-1'), { code: 'TASK_NOT_FOUND' }),
      );
      onErrorFor('T-2')(new Error('Failed to fetch'));

      // Deleted elsewhere → the cached copy goes; a transient failure keeps it.
      expect(useTaskStore.getState().taskDetailMap['T-1']).toBeUndefined();
      expect(useTaskStore.getState().taskDetailMap['T-2']).toBeDefined();
    });

    it('stores a raw-id lookup under both the raw id and the identifier', async () => {
      vi.mocked(taskService.getDetail).mockResolvedValue({
        data: { identifier: 'T-7', instruction: 'x' },
      } as any);

      await useTaskStore.getState().fetchTaskDetail('task_raw');

      const { taskDetailMap } = useTaskStore.getState();
      expect(taskDetailMap.task_raw).toMatchObject({ identifier: 'T-7' });
      expect(taskDetailMap['T-7']).toMatchObject({ identifier: 'T-7' });
    });

    it('keeps optimistic detail edits out of the persisted row', async () => {
      const scope = `task-detail-${crypto.randomUUID()}:personal`;
      vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
      vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);

      useTaskStore.getState().internal_dispatchTaskDetail({
        id: 'T-1',
        type: 'setTaskDetail',
        value: { identifier: 'T-1', name: 'Draft' } as any,
      });

      expect(useTaskStore.getState().taskDetailMap['T-1']).toMatchObject({ name: 'Draft' });
      expect(await taskDetailResource.storage!.get({ queryKey: 'T-1', scope })).toBeUndefined();
    });
  });

  describe('setActiveTaskId', () => {
    it('should set activeTaskId', () => {
      useTaskStore.getState().setActiveTaskId('T-1');
      expect(useTaskStore.getState().activeTaskId).toBe('T-1');
    });

    it('should not update if same id', () => {
      useTaskStore.setState({ activeTaskId: 'T-1' });
      const spy = vi.fn();
      useTaskStore.subscribe(spy);

      useTaskStore.getState().setActiveTaskId('T-1');
      // Should not trigger state change
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('createTask', () => {
    it('should call service and return identifier', async () => {
      vi.mocked(taskService.create).mockResolvedValue({
        data: { identifier: 'T-1' },
        message: 'ok',
        success: true,
      } as any);

      const result = await useTaskStore.getState().createTask({
        instruction: 'Do something',
        name: 'Test',
      });

      expect(taskService.create).toHaveBeenCalledWith({
        instruction: 'Do something',
        name: 'Test',
      });
      expect(result?.identifier).toBe('T-1');
    });

    it('should set isCreatingTask during creation', async () => {
      vi.mocked(taskService.create).mockImplementation(async () => {
        expect(useTaskStore.getState().isCreatingTask).toBe(true);
        return { data: { identifier: 'T-1' }, success: true } as any;
      });

      await useTaskStore.getState().createTask({ instruction: 'Test' });
      expect(useTaskStore.getState().isCreatingTask).toBe(false);
    });

    it('should reject and reset isCreatingTask on error (callers own the error path)', async () => {
      vi.mocked(taskService.create).mockRejectedValue(new Error('fail'));

      // createTask keeps its rejecting contract so callers that rely on `catch`
      // (e.g. the recommend-template flow) don't fall through to a false success;
      // the composer callers add their own catch + toast (V4).
      await expect(useTaskStore.getState().createTask({ instruction: 'Test' })).rejects.toThrow(
        'fail',
      );
      expect(useTaskStore.getState().isCreatingTask).toBe(false);
    });
  });

  describe('addComment', () => {
    const seed = () => {
      useUserStore.setState({
        isSignedIn: true,
        user: { avatar: null, fullName: 'Me', id: 'user_me' } as any,
      });
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { activities: [], identifier: 'T-1', instruction: 'x', status: 'backlog' },
        },
      });
    };

    it('shows the comment on send, before the mutation resolves', async () => {
      seed();
      let release!: () => void;
      vi.mocked(taskService.addComment).mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve({ data: { id: 'cmt_1' } } as any);
        }),
      );

      const pending = useTaskStore.getState().addComment('T-1', 'hello', { topicId: 'tpc_1' });

      const activities = useTaskStore.getState().taskDetailMap['T-1'].activities ?? [];
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        author: { id: 'user_me', name: 'Me', type: 'user' },
        content: 'hello',
        topicId: 'tpc_1',
        type: 'comment',
      });

      release();
      await pending;
    });

    it('rolls the synthesized row back through a refetch when the send fails', async () => {
      seed();
      vi.mocked(taskService.addComment).mockRejectedValue(new Error('boom'));
      const { mutate } = await import('@/libs/swr');

      await expect(useTaskStore.getState().addComment('T-1', 'hello')).rejects.toThrow('boom');

      // The refetch is the rollback; the caller still sees the failure.
      expect(mutate).toHaveBeenCalled();
    });

    it('removes the synthesized row locally when the send AND the rollback refetch fail', async () => {
      seed();
      vi.mocked(taskService.addComment).mockRejectedValue(new Error('offline'));
      const { mutate } = await import('@/libs/swr');
      vi.mocked(mutate).mockRejectedValue(new Error('still offline'));

      await expect(useTaskStore.getState().addComment('T-1', 'hello')).rejects.toThrow('offline');

      // Nothing was saved, so nothing may keep looking saved.
      expect(useTaskStore.getState().taskDetailMap['T-1'].activities).toEqual([]);
    });

    it('leaves an agent-authored comment to the refetch', async () => {
      seed();
      vi.mocked(taskService.addComment).mockResolvedValue({ data: { id: 'cmt_1' } } as any);

      await useTaskStore.getState().addComment('T-1', 'hi', { authorAgentId: 'agt_1' });

      // Nothing synthesized: the store cannot name the agent.
      expect(taskService.addComment).toHaveBeenCalledWith('T-1', 'hi', { authorAgentId: 'agt_1' });
    });
  });

  describe('updateTask', () => {
    it('should optimistically update taskDetailMap', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Old', name: 'Old Name', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTask('T-1', { name: 'New Name' });

      expect(useTaskStore.getState().taskDetailMap['T-1'].name).toBe('New Name');
      expect(taskService.update).toHaveBeenCalledWith('T-1', { name: 'New Name' });
      expect(useTaskStore.getState().taskSaveStatusMap['T-1']).toBe('saved');
    });

    it('surfaces the assignment activity in the same dispatch as the assignee chip', async () => {
      useUserStore.setState({
        isSignedIn: true,
        user: { avatar: 'me.png', fullName: 'Me', id: 'user_me' } as any,
      });
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': {
            activities: [],
            agentId: null,
            identifier: 'T-1',
            instruction: 'x',
            status: 'backlog',
          },
        },
      });
      // Hold the mutation open so we can observe the optimistic state alone.
      let release!: () => void;
      vi.mocked(taskService.update).mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve({ success: true } as any);
        }),
      );

      const pending = useTaskStore
        .getState()
        .updateTask(
          'T-1',
          { assigneeAgentId: 'agt_1' },
          { optimisticAssignee: { avatar: null, id: 'agt_1', name: 'Rika', type: 'agent' } },
        );

      const activities = useTaskStore.getState().taskDetailMap['T-1'].activities ?? [];
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        assignment: { kind: 'agent', to: { id: 'agt_1', name: 'Rika' } },
        author: { id: 'user_me', name: 'Me', type: 'user' },
        type: 'assignment',
      });

      release();
      await pending;
    });

    it('drops the previous agent’s repo selection when the task is reassigned', async () => {
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            agentId: 'agt_a',
            config: {
              execution: toTaskExecutionConfigPatch(
                applyTaskReposSelection(undefined, ['lobehub/lobehub']),
              ),
              model: 'claude-code',
            },
            identifier: 'T-1',
            instruction: 'x',
            status: 'backlog',
          },
        },
      });
      // Hold the PUT open so only the optimistic render is observed — the chip
      // must not keep showing the old agent's repo while the write is in flight.
      let release!: () => void;
      vi.mocked(taskService.update).mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve({ success: true } as any);
        }),
      );

      const pending = useTaskStore.getState().updateTask('T-1', { assigneeAgentId: 'agt_b' });

      const config = useTaskStore.getState().taskDetailMap['T-1'].config as Record<string, unknown>;
      expect(readTaskExecutionConfig(config)).toBeUndefined();
      // Only the repo axis follows the assignee; the other config pockets stay.
      expect(config.model).toBe('claude-code');

      release();
      await pending;
    });

    it('keeps a device pin and a machine directory when the task is reassigned', async () => {
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            agentId: 'agt_a',
            config: {
              execution: toTaskExecutionConfigPatch({
                boundDeviceId: 'device-a',
                workingDirectory: '/srv/app',
              }),
            },
            identifier: 'T-1',
            instruction: 'x',
            status: 'backlog',
          },
        },
      });
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTask('T-1', { assigneeAgentId: 'agt_b' });

      expect(
        readTaskExecutionConfig(
          useTaskStore.getState().taskDetailMap['T-1'].config as Record<string, unknown>,
        ),
      ).toEqual({ boundDeviceId: 'device-a', workingDirectory: '/srv/app' });
    });

    it('keeps the repo selection when the assignee does not change', async () => {
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            agentId: 'agt_a',
            config: {
              execution: toTaskExecutionConfigPatch(
                applyTaskReposSelection(undefined, ['lobehub/lobehub']),
              ),
            },
            identifier: 'T-1',
            instruction: 'x',
            status: 'backlog',
          },
        },
      });
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTask('T-1', { name: 'Renamed' });

      expect(
        readTaskExecutionConfig(
          useTaskStore.getState().taskDetailMap['T-1'].config as Record<string, unknown>,
        )?.repos,
      ).toEqual(['lobehub/lobehub']);
    });

    it('revalidates goal graphs when the assignee changes, so a goal page shows the new executor', async () => {
      useTaskStore.setState({
        taskDetailMap: { 'T-1': { identifier: 'T-1', instruction: 'x', status: 'backlog' } },
      });
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);
      const { mutate } = await import('@/libs/swr');

      await useTaskStore.getState().updateTask('T-1', { assigneeAgentId: 'agt_2' });

      // A paused goal does not poll, so without this its page kept the old avatar.
      const matchers = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key)
        .filter((key): key is (key: unknown) => boolean => typeof key === 'function');
      const matchesGoalGraph = (key: unknown) => matchers.some((match) => match(key));
      expect(matchesGoalGraph(['goal:graph', 'goal-1'])).toBe(true);
      expect(matchesGoalGraph(['goal:graph', 'goal-1', 'ws-1'])).toBe(true);
      expect(matchesGoalGraph(['task:detail', 'T-1'])).toBe(false);
    });

    it('leaves goal graphs alone when the assignee does not change', async () => {
      useTaskStore.setState({
        taskDetailMap: { 'T-1': { identifier: 'T-1', instruction: 'x', status: 'backlog' } },
      });
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);
      const { mutate } = await import('@/libs/swr');

      await useTaskStore.getState().updateTask('T-1', { priority: 2 });

      const matchers = vi
        .mocked(mutate)
        .mock.calls.map(([key]) => key)
        .filter((key): key is (key: unknown) => boolean => typeof key === 'function');
      expect(matchers.some((match) => match(['goal:graph', 'goal-1']))).toBe(false);
    });

    it('should clear stale editorData for instruction-only optimistic updates', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': {
            editorData: { root: { children: [{ text: 'Old instruction' }] } },
            identifier: 'T-1',
            instruction: 'Old instruction',
            status: 'backlog',
          },
        },
      });
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTask('T-1', { instruction: 'New instruction' });

      expect(useTaskStore.getState().taskDetailMap['T-1']).toMatchObject({
        editorData: null,
        instruction: 'New instruction',
      });
      expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBe(1);

      const nextEditorData = { root: { children: [{ text: 'Rich instruction' }] } };
      await useTaskStore.getState().updateTask('T-1', {
        editorData: nextEditorData,
        instruction: 'Rich instruction',
      });

      expect(useTaskStore.getState().taskDetailMap['T-1']).toMatchObject({
        editorData: nextEditorData,
        instruction: 'Rich instruction',
      });
      expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBe(2);
    });

    it('should keep the external revision stable for editor autosaves and matching refetches', async () => {
      const editorData = { root: { children: [{ text: 'Old instruction' }] } };
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': {
            editorData,
            identifier: 'T-1',
            instruction: 'Old instruction',
            status: 'backlog',
          },
        },
      });
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore
        .getState()
        .updateTask('T-1', { editorData, instruction: 'Old instruction' }, { source: 'editor' });

      expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBeUndefined();

      vi.mocked(taskService.getDetail).mockResolvedValue({
        data: {
          editorData: { root: { children: [{ text: 'Old instruction' }] } },
          identifier: 'T-1',
          instruction: 'Old instruction',
          status: 'backlog',
        },
        success: true,
      } as any);

      await useTaskStore.getState().fetchTaskDetail('T-1');

      expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBeUndefined();
    });

    it('should atomically bump the revision when a refetch changes the instruction snapshot', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': {
            editorData: { root: { children: [{ text: 'Old instruction' }] } },
            identifier: 'T-1',
            instruction: 'Old instruction',
            status: 'running',
          },
        },
      });
      vi.mocked(taskService.getDetail).mockResolvedValue({
        data: {
          editorData: null,
          identifier: 'T-1',
          instruction: 'Tool instruction',
          status: 'running',
        },
        success: true,
      } as any);
      const observedSnapshots: Array<[string | undefined, number | undefined]> = [];
      const unsubscribe = useTaskStore.subscribe((state) => {
        observedSnapshots.push([
          state.taskDetailMap['T-1']?.instruction,
          state.taskInstructionRevisionMap['T-1'],
        ]);
      });

      await useTaskStore.getState().fetchTaskDetail('T-1');
      unsubscribe();

      expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBe(1);
      expect(observedSnapshots).toContainEqual(['Tool instruction', 1]);
      expect(observedSnapshots).not.toContainEqual(['Old instruction', 1]);
    });

    it('should propagate error, mark saveStatus failed, refresh, and toast on failure', async () => {
      const { toast } = await import('@lobehub/ui/base-ui');
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('fail'));

      await expect(useTaskStore.getState().updateTask('T-1', { name: 'New' })).rejects.toThrow(
        'fail',
      );

      // The failure must surface as `failed` (never `idle`) so the save hint
      // shows an error + Retry instead of masquerading as a clean state.
      expect(useTaskStore.getState().taskSaveStatusMap['T-1']).toBe('failed');
      expect(taskDetailRefreshes('T-1')).not.toHaveLength(0);
      expect(toast.error).toHaveBeenCalled();
    });

    it('should reload retry content after an editor autosave failure rolls back', async () => {
      const { mutate } = await import('@/libs/swr');
      const { toast } = await import('@lobehub/ui/base-ui');
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': {
            editorData: { root: { children: [{ text: 'Persisted' }] } },
            identifier: 'T-1',
            instruction: 'Persisted',
            status: 'backlog',
          },
        },
      });
      vi.mocked(taskService.getDetail).mockResolvedValue({
        data: {
          editorData: { root: { children: [{ text: 'Persisted' }] } },
          identifier: 'T-1',
          instruction: 'Persisted',
          status: 'backlog',
        },
        success: true,
      } as any);
      vi.mocked(mutate).mockImplementation(async () => {
        await useTaskStore.getState().fetchTaskDetail('T-1');
      });
      vi.mocked(taskService.update).mockRejectedValueOnce(new Error('fail'));

      const retryData = {
        editorData: { root: { children: [{ text: 'Retry content' }] } },
        instruction: 'Retry content',
      };
      await expect(
        useTaskStore.getState().updateTask('T-1', retryData, { source: 'editor' }),
      ).rejects.toThrow('fail');

      expect(useTaskStore.getState().taskDetailMap['T-1'].instruction).toBe('Persisted');
      expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBe(1);

      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);
      const toastOptions = vi.mocked(toast.error).mock.calls.at(-1)?.[0];
      if (!toastOptions || typeof toastOptions === 'string') {
        throw new Error('Expected the failed save toast to expose a Retry action.');
      }
      const retryAction = toastOptions.actions?.[0];
      expect(retryAction).toBeDefined();
      retryAction?.onClick?.();

      await vi.waitFor(() => {
        expect(useTaskStore.getState().taskDetailMap['T-1'].instruction).toBe('Retry content');
        expect(useTaskStore.getState().taskInstructionRevisionMap['T-1']).toBe(2);
        expect(useTaskStore.getState().taskSaveStatusMap['T-1']).toBe('saved');
      });
    });

    it('lets the caller replace the failure toast Retry with its whole action', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { identifier: 'T-1', instruction: 'x', status: 'backlog' } },
      });
      vi.mocked(taskService.update).mockRejectedValueOnce(new Error('fail'));
      const retry = vi.fn();

      await expect(
        useTaskStore.getState().updateTask('T-1', { assigneeAgentId: 'agt_inbox' }, { retry }),
      ).rejects.toThrow('fail');

      const toastOptions = vi.mocked(toast.error).mock.calls.at(-1)?.[0];
      if (!toastOptions || typeof toastOptions === 'string') {
        throw new Error('Expected the failed save toast to expose a Retry action.');
      }
      toastOptions.actions?.[0]?.onClick?.();

      expect(retry).toHaveBeenCalledTimes(1);
      expect(taskService.update).toHaveBeenCalledTimes(1);
    });

    it('should refresh the cached parent on failure when updating from a subtask detail page', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-sub',
        taskDetailMap: {
          'T-parent': {
            identifier: 'T-parent',
            instruction: 'Parent',
            status: 'backlog',
            subtasks: [{ assignee: null, identifier: 'T-sub', name: 'Sub', status: 'backlog' }],
          },
          'T-sub': { identifier: 'T-sub', instruction: 'Sub', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('fail'));

      await expect(
        useTaskStore.getState().updateTask('T-sub', { assigneeAgentId: 'agent-x' }),
      ).rejects.toThrow('fail');

      expect(taskDetailRefreshes('T-sub')).not.toHaveLength(0);
      expect(taskDetailRefreshes('T-parent')).not.toHaveLength(0);
    });

    it('should not show error when update succeeds but cache refresh fails', async () => {
      const { mutate } = await import('@/libs/swr');
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);
      vi.mocked(mutate).mockRejectedValue(new Error('network blip'));

      await useTaskStore.getState().updateTask('T-1', { assigneeAgentId: 'agent-x' });

      expect(useTaskStore.getState().taskSaveStatusMap['T-1']).toBe('saved');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('should refresh list and affected details when reparenting', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-sub',
        taskDetailMap: {
          'T-parent': {
            identifier: 'T-parent',
            instruction: 'Parent',
            status: 'backlog',
            subtasks: [{ assignee: null, identifier: 'T-sub', name: 'Sub', status: 'backlog' }],
          },
          'T-sub': { identifier: 'T-sub', instruction: 'Sub', status: 'backlog' },
        },
      });

      const refreshTaskList = vi.fn().mockResolvedValue(undefined);
      useTaskStore.setState({ refreshTaskList } as any);
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTask('T-sub', { parentTaskId: 'T-new-parent' });

      expect(taskService.update).toHaveBeenCalledWith('T-sub', { parentTaskId: 'T-new-parent' });
      expect(useTaskStore.getState().taskDetailMap['T-sub']).not.toHaveProperty('parentTaskId');
      expect(refreshTaskList).toHaveBeenCalled();
      expect(taskDetailRefreshes('T-sub')).not.toHaveLength(0);
      expect(taskDetailRefreshes('T-parent')).not.toHaveLength(0);
      expect(taskDetailRefreshes('T-new-parent')).not.toHaveLength(0);
    });

    it('should refresh the list after changing priority', async () => {
      const refreshTaskList = vi.fn().mockResolvedValue(undefined);
      useTaskStore.setState({ refreshTaskList } as any);
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTask('T-1', { priority: 2 });

      expect(refreshTaskList).toHaveBeenCalled();
    });

    it('should refresh the parent that was patched even if activeTaskId changes mid-flight', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-parent',
        taskDetailMap: {
          'T-parent': {
            identifier: 'T-parent',
            instruction: 'Parent',
            status: 'backlog',
            subtasks: [{ assignee: null, identifier: 'T-sub', name: 'Sub', status: 'backlog' }],
          },
        },
      });

      vi.mocked(taskService.update).mockImplementation(async () => {
        useTaskStore.setState({ activeTaskId: 'T-other' });
        throw new Error('fail');
      });

      await expect(
        useTaskStore.getState().updateTask('T-sub', { assigneeAgentId: 'agent-x' }),
      ).rejects.toThrow('fail');

      expect(taskDetailRefreshes('T-sub')).not.toHaveLength(0);
      expect(taskDetailRefreshes('T-parent')).not.toHaveLength(0);
    });

    it('should scope save status per task so a failure does not leak across navigation', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'One', status: 'backlog' },
          'T-2': { identifier: 'T-2', instruction: 'Two', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('fail'));

      await expect(useTaskStore.getState().updateTask('T-1', { name: 'New' })).rejects.toThrow(
        'fail',
      );

      // Opening task T-2 must show a clean state — T-1's `failed` stays with T-1.
      useTaskStore.getState().setActiveTaskId('T-2');
      expect(taskDetailSelectors.taskSaveStatus(useTaskStore.getState())).toBe('idle');

      // Returning to T-1 still reflects its own failed save.
      useTaskStore.getState().setActiveTaskId('T-1');
      expect(taskDetailSelectors.taskSaveStatus(useTaskStore.getState())).toBe('failed');
    });
  });

  describe('deleteTask', () => {
    it('should remove from map, clear activeTaskId, and return deleted task data', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.delete).mockResolvedValue({
        data: { identifier: 'T-1', name: 'Test Task' },
        success: true,
      } as any);

      const result = await useTaskStore.getState().deleteTask('T-1');

      expect(result?.identifier).toBe('T-1');
      expect(result?.name).toBe('Test Task');
      expect(useTaskStore.getState().taskDetailMap['T-1']).toBeUndefined();
      expect(useTaskStore.getState().activeTaskId).toBeUndefined();
      expect(workService.refreshAllConversations).toHaveBeenCalled();
    });

    it('should set isDeletingTask during deletion', async () => {
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.delete).mockImplementation(async () => {
        expect(useTaskStore.getState().isDeletingTask).toBe(true);
        return { data: { identifier: 'T-1' }, success: true } as any;
      });

      await useTaskStore.getState().deleteTask('T-1');
      expect(useTaskStore.getState().isDeletingTask).toBe(false);
    });

    it('should not rollback delete when work cache refresh fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.delete).mockResolvedValue({
        data: { identifier: 'T-1' },
        success: true,
      } as any);
      vi.mocked(workService.refreshAllConversations).mockRejectedValue(new Error('refresh failed'));

      const result = await useTaskStore.getState().deleteTask('T-1');

      expect(result?.identifier).toBe('T-1');
      expect(useTaskStore.getState().taskDetailMap['T-1']).toBeUndefined();
      expect(consoleError).toHaveBeenCalledWith('[task:deleteTask:refreshWork]', expect.any(Error));
      consoleError.mockRestore();
    });

    it('should rollback optimistic delete and propagate error on failure', async () => {
      const snapshot = {
        identifier: 'T-1',
        instruction: 'Test',
        name: 'Original',
        status: 'backlog',
      };
      useTaskStore.setState({ taskDetailMap: { 'T-1': snapshot as any } });

      vi.mocked(taskService.delete).mockRejectedValue(new Error('server down'));

      await expect(useTaskStore.getState().deleteTask('T-1')).rejects.toThrow('server down');

      expect(useTaskStore.getState().taskDetailMap['T-1']).toEqual(snapshot);
      expect(useTaskStore.getState().isDeletingTask).toBe(false);
      expect(workService.refreshAllConversations).not.toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    it('should call service and refresh detail', async () => {
      vi.mocked(taskService.addComment).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().addComment('T-1', 'Nice work');

      expect(taskService.addComment).toHaveBeenCalledWith('T-1', 'Nice work', undefined);
      expect(taskDetailRefreshes('T-1')).not.toHaveLength(0);
    });
  });

  describe('addDependency', () => {
    it('should call service and refresh detail', async () => {
      vi.mocked(taskService.addDependency).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().addDependency('T-1', 'T-2', 'blocks');

      expect(taskService.addDependency).toHaveBeenCalledWith('T-1', 'T-2', 'blocks');
      expect(taskDetailRefreshes('T-1')).not.toHaveLength(0);
    });

    it('should propagate error from service', async () => {
      vi.mocked(taskService.addDependency).mockRejectedValue(new Error('cycle detected'));

      await expect(useTaskStore.getState().addDependency('T-1', 'T-2', 'blocks')).rejects.toThrow(
        'cycle detected',
      );
    });
  });

  describe('removeDependency', () => {
    it('should call service and refresh detail', async () => {
      vi.mocked(taskService.removeDependency).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().removeDependency('T-1', 'T-2');

      expect(taskService.removeDependency).toHaveBeenCalledWith('T-1', 'T-2');
      expect(taskDetailRefreshes('T-1')).not.toHaveLength(0);
    });
  });

  describe('unpinDocument', () => {
    it('should refresh source task and active task when they differ', async () => {
      vi.mocked(taskService.unpinDocument).mockResolvedValue({ success: true } as any);

      // Detail page is open at parent identifier; doc is owned by a child DB id.
      useTaskStore.setState({ activeTaskId: 'T-1' });

      await useTaskStore.getState().unpinDocument('task_child', 'doc_1');

      expect(taskService.unpinDocument).toHaveBeenCalledWith('task_child', 'doc_1');
      expect(taskDetailRefreshes('task_child')).not.toHaveLength(0);
      expect(taskDetailRefreshes('T-1')).not.toHaveLength(0);
    });

    it('should not double-refresh when source task equals active task', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.unpinDocument).mockResolvedValue({ success: true } as any);

      useTaskStore.setState({ activeTaskId: 'T-1' });

      await useTaskStore.getState().unpinDocument('T-1', 'doc_1');

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(taskDetailRefreshes('T-1')).not.toHaveLength(0);
    });
  });

  describe('internal_dispatchTaskDetail', () => {
    it('should set task detail via reducer', () => {
      const detail = { identifier: 'T-1', instruction: 'Test', status: 'backlog' } as any;

      useTaskStore.getState().internal_dispatchTaskDetail({
        id: 'T-1',
        type: 'setTaskDetail',
        value: detail,
      });

      expect(useTaskStore.getState().taskDetailMap['T-1']).toEqual(detail);
    });

    it('should not update state if reducer returns same reference', () => {
      const detail = { identifier: 'T-1', instruction: 'Test', status: 'backlog' } as any;
      useTaskStore.setState({ taskDetailMap: { 'T-1': detail } });

      const spy = vi.fn();
      useTaskStore.subscribe(spy);

      // Update with non-existent id — reducer returns same state
      useTaskStore.getState().internal_dispatchTaskDetail({
        id: 'T-999',
        type: 'updateTaskDetail',
        value: { name: 'Ghost' },
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
