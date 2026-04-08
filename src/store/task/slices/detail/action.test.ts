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

beforeEach(() => {
  vi.clearAllMocks();
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
      expect(result).toBe('T-1');
    });

    it('should set isCreatingTask during creation', async () => {
      vi.mocked(taskService.create).mockImplementation(async () => {
        expect(useTaskStore.getState().isCreatingTask).toBe(true);
        return { data: { identifier: 'T-1' }, success: true } as any;
      });

      await useTaskStore.getState().createTask({ instruction: 'Test' });
      expect(useTaskStore.getState().isCreatingTask).toBe(false);
    });

    it('should return null on error', async () => {
      vi.mocked(taskService.create).mockRejectedValue(new Error('fail'));

      const result = await useTaskStore.getState().createTask({ instruction: 'Test' });
      expect(result).toBeNull();
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

    it('should refresh on error', async () => {
      const { mutate } = await import('@/libs/swr');
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('fail'));

      await useTaskStore.getState().updateTask('T-1', { name: 'New' });

      expect(useTaskStore.getState().taskSaveStatus).toBe('idle');
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });

  describe('deleteTask', () => {
    it('should remove from map and clear activeTaskId', async () => {
      useTaskStore.setState({
        activeTaskId: 'T-1',
        taskDetailMap: {
          'T-1': { identifier: 'T-1', instruction: 'Test', status: 'backlog' },
        },
      });

      vi.mocked(taskService.delete).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().deleteTask('T-1');

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
        return { success: true } as any;
      });

      await useTaskStore.getState().deleteTask('T-1');
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
