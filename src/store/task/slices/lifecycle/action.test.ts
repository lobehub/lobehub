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
  });
});

describe('TaskLifecycleSliceAction', () => {
  describe('runTask', () => {
    it('should optimistically set status to running and call service', async () => {
      vi.mocked(taskService.run).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().runTask('T-1');

      expect(taskService.run).toHaveBeenCalledWith('T-1', undefined);
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

      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
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
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
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
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });
});
