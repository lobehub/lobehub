import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskService } from '@/services/task';

import { useTaskStore } from '../../store';

vi.mock('@/services/task', () => ({
  taskService: {
    cancelTopic: vi.fn(),
    deleteTopic: vi.fn(),
    run: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

const mockDetail = { identifier: 'T-1', instruction: 'Test', status: 'backlog' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    activeTaskId: 'T-1',
    taskDetailMap: { 'T-1': { ...mockDetail } },
    taskGroups: [],
    tasks: [],
  });
});

describe('TaskLifecycleSliceAction', () => {
  describe('runTask', () => {
    it('should optimistically set status to running and call service', async () => {
      vi.mocked(taskService.run).mockResolvedValue({ success: true } as any);

      const result = await useTaskStore.getState().runTask('T-1');

      expect(taskService.run).toHaveBeenCalledWith('T-1', undefined);
      expect(result).toEqual({ success: true });
    });

    it('should pass prompt and continueTopicId', async () => {
      vi.mocked(taskService.run).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().runTask('T-1', {
        continueTopicId: 'tpc_1',
        prompt: 'Focus on edge cases',
      });

      expect(taskService.run).toHaveBeenCalledWith('T-1', {
        continueTopicId: 'tpc_1',
        prompt: 'Focus on edge cases',
      });
    });

    it('should refresh detail on error', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.run).mockRejectedValue(new Error('fail'));

      await useTaskStore.getState().runTask('T-1');

      expect(mutate).toHaveBeenCalledWith(['task:detail', 'T-1']);
    });

    it('should surface the run failure when the caller requires it', async () => {
      vi.mocked(taskService.run).mockRejectedValue(new Error('fail'));

      await expect(
        useTaskStore.getState().runTask('T-1', undefined, { throwOnError: true }),
      ).rejects.toThrow('fail');
    });

    it('should preserve a successful run result when cache refreshes fail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.run).mockResolvedValue({ topicId: 'tpc-1' } as any);
      vi.mocked(mutate)
        .mockRejectedValueOnce(new Error('detail refresh failed'))
        .mockRejectedValueOnce(new Error('list refresh failed'))
        .mockRejectedValueOnce(new Error('group refresh failed'));

      const result = await useTaskStore
        .getState()
        .runTask('T-1', undefined, { throwOnError: true });

      expect(result).toEqual({ topicId: 'tpc-1' });
    });
  });

  describe('updateTaskStatus', () => {
    it('should call updateStatus with paused', async () => {
      vi.mocked(taskService.updateStatus).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTaskStatus('T-1', 'paused');

      expect(taskService.updateStatus).toHaveBeenCalledWith('T-1', 'paused', undefined);
    });

    it('should optimistically set status', async () => {
      vi.mocked(taskService.updateStatus).mockImplementation(async () => {
        expect(useTaskStore.getState().taskDetailMap['T-1'].status).toBe('paused');
        return { success: true } as any;
      });

      await useTaskStore.getState().updateTaskStatus('T-1', 'paused');
    });

    it('should immediately synchronize list and kanban collections', async () => {
      useTaskStore.setState({
        taskGroups: [
          { key: 'backlog', tasks: [{ identifier: 'T-1', status: 'backlog' }], total: 1 },
          { key: 'done', tasks: [], total: 0 },
        ] as any,
        tasks: [{ identifier: 'T-1', status: 'backlog' }] as any,
      });
      vi.mocked(taskService.updateStatus).mockImplementation(async () => {
        const state = useTaskStore.getState();

        expect(state.tasks.find((task) => task.identifier === 'T-1')?.status).toBe('completed');
        expect(state.taskGroups.find((group) => group.key === 'backlog')).toMatchObject({
          tasks: [],
          total: 0,
        });
        expect(state.taskGroups.find((group) => group.key === 'done')).toMatchObject({
          tasks: [expect.objectContaining({ identifier: 'T-1', status: 'completed' })],
          total: 1,
        });

        return { success: true } as any;
      });

      await useTaskStore.getState().updateTaskStatus('T-1', 'completed');
    });

    it('should roll list and kanban collections back when the status update fails', async () => {
      useTaskStore.setState({
        taskGroups: [
          { key: 'backlog', tasks: [{ identifier: 'T-1', status: 'backlog' }], total: 1 },
          { key: 'done', tasks: [], total: 0 },
        ] as any,
        tasks: [{ identifier: 'T-1', status: 'backlog' }] as any,
      });
      vi.mocked(taskService.updateStatus).mockRejectedValue(new Error('fail'));

      await expect(useTaskStore.getState().updateTaskStatus('T-1', 'completed')).rejects.toThrow(
        'fail',
      );

      const state = useTaskStore.getState();
      expect(state.tasks.find((task) => task.identifier === 'T-1')?.status).toBe('backlog');
      expect(state.taskGroups.find((group) => group.key === 'backlog')).toMatchObject({
        tasks: [expect.objectContaining({ identifier: 'T-1', status: 'backlog' })],
        total: 1,
      });
      expect(state.taskGroups.find((group) => group.key === 'done')).toMatchObject({
        tasks: [],
        total: 0,
      });
    });

    it('should preserve the committed status when cache refreshes fail', async () => {
      const { mutate } = await import('@/libs/swr');
      useTaskStore.setState({
        taskGroups: [
          { key: 'backlog', tasks: [{ identifier: 'T-1', status: 'backlog' }], total: 1 },
          { key: 'done', tasks: [], total: 0 },
        ] as any,
        tasks: [{ identifier: 'T-1', status: 'backlog' }] as any,
      });
      vi.mocked(taskService.updateStatus).mockResolvedValue({ success: true } as any);
      vi.mocked(mutate)
        .mockRejectedValueOnce(new Error('detail refresh failed'))
        .mockRejectedValueOnce(new Error('list refresh failed'))
        .mockRejectedValueOnce(new Error('group refresh failed'));

      await expect(useTaskStore.getState().updateTaskStatus('T-1', 'completed')).resolves.toBe(
        'T-1',
      );

      const state = useTaskStore.getState();
      expect(state.tasks.find((task) => task.identifier === 'T-1')?.status).toBe('completed');
      expect(state.taskGroups.find((group) => group.key === 'done')).toMatchObject({
        tasks: [expect.objectContaining({ identifier: 'T-1', status: 'completed' })],
        total: 1,
      });
    });

    it('should not let an older failed request roll back a newer status', async () => {
      let rejectFirstRequest: (reason: Error) => void = () => {};
      useTaskStore.setState({
        taskGroups: [
          { key: 'backlog', tasks: [{ identifier: 'T-1', status: 'backlog' }], total: 1 },
          { key: 'done', tasks: [], total: 0 },
          { key: 'canceled', tasks: [], total: 0 },
        ] as any,
        tasks: [{ identifier: 'T-1', status: 'backlog' }] as any,
      });
      vi.mocked(taskService.updateStatus)
        .mockImplementationOnce(
          async () =>
            new Promise((_, reject) => {
              rejectFirstRequest = reject;
            }),
        )
        .mockResolvedValueOnce({ success: true } as any);

      const firstRequest = useTaskStore.getState().updateTaskStatus('T-1', 'completed');
      const secondRequest = useTaskStore.getState().updateTaskStatus('T-1', 'canceled');

      await secondRequest;
      rejectFirstRequest(new Error('first request failed'));
      await expect(firstRequest).rejects.toThrow('first request failed');

      const state = useTaskStore.getState();
      expect(state.tasks.find((task) => task.identifier === 'T-1')?.status).toBe('canceled');
      expect(state.taskGroups.find((group) => group.key === 'canceled')).toMatchObject({
        tasks: [expect.objectContaining({ identifier: 'T-1', status: 'canceled' })],
        total: 1,
      });
      expect(state.taskGroups.find((group) => group.key === 'done')).toMatchObject({
        tasks: [],
        total: 0,
      });
    });

    it('should call updateStatus with canceled', async () => {
      vi.mocked(taskService.updateStatus).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTaskStatus('T-1', 'canceled');

      expect(taskService.updateStatus).toHaveBeenCalledWith('T-1', 'canceled', undefined);
    });

    it('should call updateStatus with backlog', async () => {
      vi.mocked(taskService.updateStatus).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTaskStatus('T-1', 'backlog');

      expect(taskService.updateStatus).toHaveBeenCalledWith('T-1', 'backlog', undefined);
    });

    it('should call updateStatus with completed', async () => {
      vi.mocked(taskService.updateStatus).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateTaskStatus('T-1', 'completed');

      expect(taskService.updateStatus).toHaveBeenCalledWith('T-1', 'completed', undefined);
    });
  });

  describe('cancelTopic', () => {
    it('should call service and refresh active detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.cancelTopic).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().cancelTopic('tpc_1');

      expect(taskService.cancelTopic).toHaveBeenCalledWith('tpc_1');
      expect(mutate).toHaveBeenCalledWith(['task:detail', 'T-1']);
    });

    it('should not refresh if no activeTaskId', async () => {
      const { mutate } = await import('@/libs/swr');
      useTaskStore.setState({ activeTaskId: undefined });
      vi.mocked(taskService.cancelTopic).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().cancelTopic('tpc_1');

      expect(taskService.cancelTopic).toHaveBeenCalledWith('tpc_1');
      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('deleteTopic', () => {
    it('should call service and refresh active detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.deleteTopic).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().deleteTopic('tpc_1');

      expect(taskService.deleteTopic).toHaveBeenCalledWith('tpc_1');
      expect(mutate).toHaveBeenCalledWith(['task:detail', 'T-1']);
    });
  });
});
