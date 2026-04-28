import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskService } from '@/services/task';

import { useTaskStore } from '../../store';

vi.mock('@/services/task', () => ({
  taskService: {
    markBriefRead: vi.fn(),
    resolveBrief: vi.fn(),
    runReview: vi.fn(),
    update: vi.fn(),
    updateCheckpoint: vi.fn(),
    updateConfig: vi.fn(),
    updateReview: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

const mockDetail = {
  checkpoint: { onAgentRequest: false },
  identifier: 'T-1',
  instruction: 'Test',
  review: null,
  status: 'backlog',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    activeTaskId: 'T-1',
    taskDetailMap: { 'T-1': { ...mockDetail } },
  });
});

describe('TaskConfigSliceAction', () => {
  describe('updateCheckpoint', () => {
    it('should optimistically update and call service', async () => {
      vi.mocked(taskService.updateCheckpoint).mockResolvedValue({ success: true } as any);

      const checkpoint = { onAgentRequest: true };
      await useTaskStore.getState().updateCheckpoint('T-1', checkpoint);

      expect(useTaskStore.getState().taskDetailMap['T-1'].checkpoint).toEqual(checkpoint);
      expect(taskService.updateCheckpoint).toHaveBeenCalledWith('T-1', checkpoint);
    });

    it('should refresh on error', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.updateCheckpoint).mockRejectedValue(new Error('fail'));

      await useTaskStore.getState().updateCheckpoint('T-1', { onAgentRequest: true });

      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });

  describe('updateReview', () => {
    it('should optimistically update and call service', async () => {
      vi.mocked(taskService.updateReview).mockResolvedValue({ success: true } as any);

      const review = { enabled: true, rubrics: [] };
      await useTaskStore.getState().updateReview('T-1', review as any);

      expect(useTaskStore.getState().taskDetailMap['T-1'].review).toEqual(review);
      expect(taskService.updateReview).toHaveBeenCalledWith({ id: 'T-1', review });
    });
  });

  describe('runReview', () => {
    it('should call service and refresh detail', async () => {
      const { mutate } = await import('@/libs/swr');
      const mockResult = { overallScore: 85, passed: true };
      vi.mocked(taskService.runReview).mockResolvedValue({
        data: mockResult,
        success: true,
      } as any);

      const result = await useTaskStore.getState().runReview('T-1', { content: 'Test output' });

      expect(taskService.runReview).toHaveBeenCalledWith('T-1', { content: 'Test output' });
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
      expect(result).toEqual({ data: mockResult, success: true });
    });

    it('should throw on error', async () => {
      vi.mocked(taskService.runReview).mockRejectedValue(new Error('review failed'));

      await expect(useTaskStore.getState().runReview('T-1', { content: 'Test' })).rejects.toThrow(
        'review failed',
      );
    });
  });

  describe('updateTaskModelConfig', () => {
    it('should call updateConfig with model/provider and refresh detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.updateConfig).mockResolvedValue({ success: true } as any);

      await useTaskStore
        .getState()
        .updateTaskModelConfig('T-1', { model: 'claude-sonnet-4-6', provider: 'anthropic' });

      expect(taskService.updateConfig).toHaveBeenCalledWith('T-1', {
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
      });
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });

  describe('updatePeriodicInterval', () => {
    it('should call update with heartbeatInterval and refresh detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updatePeriodicInterval('T-1', 600);

      expect(taskService.update).toHaveBeenCalledWith('T-1', { heartbeatInterval: 600 });
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });

    it('should send 0 when null to disable interval (automationMode untouched)', async () => {
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updatePeriodicInterval('T-1', null);

      expect(taskService.update).toHaveBeenCalledWith('T-1', { heartbeatInterval: 0 });
    });
  });

  describe('setAutomationMode', () => {
    it('should seed default heartbeat interval when first enabling', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().setAutomationMode('T-1', 'heartbeat');

      expect(useTaskStore.getState().taskDetailMap['T-1'].automationMode).toBe('heartbeat');
      expect(taskService.update).toHaveBeenCalledWith('T-1', {
        automationMode: 'heartbeat',
        heartbeatInterval: 600,
      });
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });

    it('should preserve existing heartbeat interval when re-entering heartbeat mode', async () => {
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            ...useTaskStore.getState().taskDetailMap['T-1'],
            heartbeat: { interval: 1800 },
          },
        },
      });

      await useTaskStore.getState().setAutomationMode('T-1', 'heartbeat');

      expect(taskService.update).toHaveBeenCalledWith('T-1', { automationMode: 'heartbeat' });
    });

    it('should seed default cron pattern + local timezone when entering schedule mode', async () => {
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().setAutomationMode('T-1', 'schedule');

      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      expect(taskService.update).toHaveBeenCalledWith('T-1', {
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        scheduleTimezone: localTz,
      });
    });

    it('should override DB-default UTC timezone on first-time schedule enable', async () => {
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      // The tasks table has `schedule_timezone TEXT DEFAULT 'UTC'`, so a row that
      // has never had its schedule configured still surfaces timezone='UTC'.
      // First-time enable (no pattern yet) must override with the user's local tz.
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            ...useTaskStore.getState().taskDetailMap['T-1'],
            schedule: { pattern: null, timezone: 'UTC' },
          },
        },
      });

      await useTaskStore.getState().setAutomationMode('T-1', 'schedule');

      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      expect(taskService.update).toHaveBeenCalledWith('T-1', {
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        scheduleTimezone: localTz,
      });
    });

    it('should preserve user-chosen timezone when re-entering schedule mode', async () => {
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            ...useTaskStore.getState().taskDetailMap['T-1'],
            schedule: { pattern: '0 8 * * 1', timezone: 'Asia/Shanghai' },
          },
        },
      });

      await useTaskStore.getState().setAutomationMode('T-1', 'schedule');

      expect(taskService.update).toHaveBeenCalledWith('T-1', { automationMode: 'schedule' });
    });

    it('should accept null to disable automation', async () => {
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().setAutomationMode('T-1', null);

      expect(useTaskStore.getState().taskDetailMap['T-1'].automationMode).toBeNull();
      expect(taskService.update).toHaveBeenCalledWith('T-1', { automationMode: null });
    });
  });

  describe('resolveBrief', () => {
    it('should call service and refresh active detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.resolveBrief).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().resolveBrief('brief_1', { action: 'approve' });

      expect(taskService.resolveBrief).toHaveBeenCalledWith('brief_1', { action: 'approve' });
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });

  describe('markBriefRead', () => {
    it('should call service and refresh active detail', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.markBriefRead).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().markBriefRead('brief_1');

      expect(taskService.markBriefRead).toHaveBeenCalledWith('brief_1');
      expect(mutate).toHaveBeenCalledWith(['fetchTaskDetail', 'T-1']);
    });
  });
});
