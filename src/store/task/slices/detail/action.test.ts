import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskService } from '@/services/task';

import { useTaskStore } from '../../store';

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

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { error: vi.fn(), success: vi.fn() },
  modal: { confirm: vi.fn() },
  notification: { error: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  useTaskStore.setState({
    activeTaskId: undefined,
    isCreatingTask: false,
    isDeletingTask: false,
    taskDetailMap: {},
    taskSaveStatus: 'idle',
  });
});

describe('TaskDetailSliceAction', () => {
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

    it('should throw on error and reset isCreatingTask', async () => {
      vi.mocked(taskService.create).mockRejectedValue(new Error('fail'));

      await expect(useTaskStore.getState().createTask({ instruction: 'Test' })).rejects.toThrow(
        'fail',
      );
      expect(useTaskStore.getState().isCreatingTask).toBe(false);
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
      expect(useTaskStore.getState().taskSaveStatus).toBe('saved');
    });

    it('should propagate error, reset saveStatus, refresh, and toast on failure', async () => {
      const { mutate } = await import('@/libs/swr');
      const { message } = await import('@/components/AntdStaticMethods');
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('fail'));

      await expect(useTaskStore.getState().updateTask('T-1', { name: 'New' })).rejects.toThrow(
        'fail',
      );

      expect(useTaskStore.getState().taskSaveStatus).toBe('idle');
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
      expect(message.error).toHaveBeenCalled();
    });

    it('should refresh the cached parent on failure when updating from a subtask detail page', async () => {
      const { mutate } = await import('@/libs/swr');
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

      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-sub']);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-parent']);
    });

    it('should not show error when update succeeds but cache refresh fails', async () => {
      const { mutate } = await import('@/libs/swr');
      const { message } = await import('@/components/AntdStaticMethods');
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);
      vi.mocked(mutate).mockRejectedValue(new Error('network blip'));

      await useTaskStore.getState().updateTask('T-1', { assigneeAgentId: 'agent-x' });

      expect(useTaskStore.getState().taskSaveStatus).toBe('saved');
      expect(message.error).not.toHaveBeenCalled();
    });

    it('should refresh list and affected details when reparenting', async () => {
      const { mutate } = await import('@/libs/swr');
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
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-sub']);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-parent']);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-new-parent']);
    });

    it('should refresh the parent that was patched even if activeTaskId changes mid-flight', async () => {
      const { mutate } = await import('@/libs/swr');
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

      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-sub']);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-parent']);
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
    });
  });

  describe('addComment', () => {
    it('should call service and refresh detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.addComment).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().addComment('T-1', 'Nice work');

      expect(taskService.addComment).toHaveBeenCalledWith('T-1', 'Nice work', undefined);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });

  describe('addDependency', () => {
    it('should call service and refresh detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.addDependency).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().addDependency('T-1', 'T-2', 'blocks');

      expect(taskService.addDependency).toHaveBeenCalledWith('T-1', 'T-2', 'blocks');
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
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
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.removeDependency).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().removeDependency('T-1', 'T-2');

      expect(taskService.removeDependency).toHaveBeenCalledWith('T-1', 'T-2');
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });

  describe('unpinDocument', () => {
    it('should refresh source task and active task when they differ', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.unpinDocument).mockResolvedValue({ success: true } as any);

      // Detail page is open at parent identifier; doc is owned by a child DB id.
      useTaskStore.setState({ activeTaskId: 'T-1' });

      await useTaskStore.getState().unpinDocument('task_child', 'doc_1');

      expect(taskService.unpinDocument).toHaveBeenCalledWith('task_child', 'doc_1');
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'task_child']);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });

    it('should not double-refresh when source task equals active task', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.unpinDocument).mockResolvedValue({ success: true } as any);

      useTaskStore.setState({ activeTaskId: 'T-1' });

      await useTaskStore.getState().unpinDocument('T-1', 'doc_1');

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
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
