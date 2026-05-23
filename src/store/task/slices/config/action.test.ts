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
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().setAutomationMode('T-1', 'heartbeat');

      expect(useTaskStore.getState().taskDetailMap['T-1'].automationMode).toBe('heartbeat');
      // Default heartbeat interval is mirrored into the local detail in the
      // same optimistic patch so we don't need to refresh from the server.
      expect(useTaskStore.getState().taskDetailMap['T-1'].heartbeat?.interval).toBe(600);
      expect(taskService.update).toHaveBeenCalledWith('T-1', {
        automationMode: 'heartbeat',
        heartbeatInterval: 600,
      });
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

    it('serializes rapid toggles, applies optimistic state immediately, and never refreshes', async () => {
      const { mutate } = await import('@/libs/swr');
      // Macrotask flush — drains the microtask queue, enough for
      // OptimisticEngine to resolve the previous PUT, run its post-await
      // steps, and synchronously kick off the next mutation's PUT.
      const flush = () => new Promise((r) => setTimeout(r, 0));

      // Resolvers we can flip in click order to prove PUTs don't reorder.
      const settlers: Array<() => void> = [];
      vi.mocked(taskService.update).mockImplementation(
        () =>
          new Promise((resolve) => {
            settlers.push(() => resolve({ success: true } as any));
          }),
      );

      // Fire three toggles back-to-back (schedule → heartbeat → schedule)
      // without awaiting — mirrors a rapid Segmented click stream.
      const store = useTaskStore.getState();
      const p1 = store.setAutomationMode('T-1', 'schedule');
      const p2 = store.setAutomationMode('T-1', 'heartbeat');
      const p3 = store.setAutomationMode('T-1', 'schedule');

      expect(useTaskStore.getState().taskDetailMap['T-1'].automationMode).toBe('schedule');

      // Engine has started only the first PUT; the other two are queued on
      // the conflicting `taskDetailMap.T-1` path.
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(1);

      // Resolve in order; each release unblocks exactly the next PUT.
      settlers[0]();
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(2);

      settlers[1]();
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(3);

      settlers[2]();
      await Promise.all([p1, p2, p3]);

      const calls = vi.mocked(taskService.update).mock.calls.map((c) => c[1].automationMode);
      expect(calls).toEqual(['schedule', 'heartbeat', 'schedule']);

      // Final store still matches the last click — no stale SWR refresh can
      // race-overwrite it back to schedule/heartbeat mid-stream.
      expect(useTaskStore.getState().taskDetailMap['T-1'].automationMode).toBe('schedule');
      const refreshCalls = vi
        .mocked(mutate)
        .mock.calls.filter((c) => Array.isArray(c[0]) && c[0][0] === 'fetchTaskDetail');
      expect(refreshCalls).toHaveLength(0);
    });

    it('rolls back the optimistic store update when the PUT fails', async () => {
      // Seed an existing schedule mode so we can verify the rollback target.
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            ...useTaskStore.getState().taskDetailMap['T-1'],
            automationMode: 'schedule',
            schedule: { pattern: '0 9 * * *', timezone: 'Asia/Shanghai' },
          },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('boom'));

      await useTaskStore.getState().setAutomationMode('T-1', 'heartbeat');

      // Engine replayed inverse patches → store back to pre-call snapshot.
      const detail = useTaskStore.getState().taskDetailMap['T-1'];
      expect(detail.automationMode).toBe('schedule');
      expect(detail.heartbeat?.interval).toBeUndefined();
    });
  });

  describe('updateSchedule', () => {
    it('mirrors pattern, timezone, and maxExecutions into the local detail and PUTs the flat shape', async () => {
      const { mutate } = await import('@/libs/swr');
      vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);

      await useTaskStore.getState().updateSchedule('T-1', {
        maxExecutions: 5,
        pattern: '0 9 * * 1-5',
        timezone: 'Asia/Shanghai',
      });

      const detail = useTaskStore.getState().taskDetailMap['T-1'];
      expect(detail.schedule).toEqual({
        maxExecutions: 5,
        pattern: '0 9 * * 1-5',
        timezone: 'Asia/Shanghai',
      });
      expect((detail.config as any).schedule.maxExecutions).toBe(5);
      expect(taskService.update).toHaveBeenCalledWith('T-1', {
        config: { schedule: { maxExecutions: 5 } },
        schedulePattern: '0 9 * * 1-5',
        scheduleTimezone: 'Asia/Shanghai',
      });
      // No SWR refresh — optimistic patch is the source of truth.
      const refreshCalls = vi
        .mocked(mutate)
        .mock.calls.filter((c) => Array.isArray(c[0]) && c[0][0] === 'fetchTaskDetail');
      expect(refreshCalls).toHaveLength(0);
    });

    it('serializes rapid weekday-toggle edits and keeps the user’s final input', async () => {
      const flush = () => new Promise((r) => setTimeout(r, 0));

      const settlers: Array<() => void> = [];
      vi.mocked(taskService.update).mockImplementation(
        () =>
          new Promise((resolve) => {
            settlers.push(() => resolve({ success: true } as any));
          }),
      );

      const store = useTaskStore.getState();
      const args = (pattern: string) => ({ maxExecutions: null, pattern, timezone: 'UTC' });
      const p1 = store.updateSchedule('T-1', args('0 9 * * 1'));
      const p2 = store.updateSchedule('T-1', args('0 9 * * 1,2'));
      const p3 = store.updateSchedule('T-1', args('0 9 * * 1,2,3'));

      // Store reflects the most recent click immediately.
      expect(useTaskStore.getState().taskDetailMap['T-1'].schedule?.pattern).toBe('0 9 * * 1,2,3');

      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(1);
      settlers[0]();
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(2);
      settlers[1]();
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(3);
      settlers[2]();
      await Promise.all([p1, p2, p3]);

      const patterns = vi.mocked(taskService.update).mock.calls.map((c) => c[1].schedulePattern);
      expect(patterns).toEqual(['0 9 * * 1', '0 9 * * 1,2', '0 9 * * 1,2,3']);
      expect(useTaskStore.getState().taskDetailMap['T-1'].schedule?.pattern).toBe('0 9 * * 1,2,3');
    });

    it('shares the engine path with setAutomationMode, so a mode toggle and a schedule edit serialize', async () => {
      const flush = () => new Promise((r) => setTimeout(r, 0));

      const settlers: Array<() => void> = [];
      vi.mocked(taskService.update).mockImplementation(
        () =>
          new Promise((resolve) => {
            settlers.push(() => resolve({ success: true } as any));
          }),
      );

      const store = useTaskStore.getState();
      const pA = store.setAutomationMode('T-1', 'schedule');
      const pB = store.updateSchedule('T-1', {
        maxExecutions: null,
        pattern: '0 10 * * *',
        timezone: 'UTC',
      });

      // First PUT runs; the second is queued on the conflicting path.
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(1);

      settlers[0]();
      await flush();
      expect(taskService.update).toHaveBeenCalledTimes(2);

      settlers[1]();
      await Promise.all([pA, pB]);
    });

    it('rolls back the schedule patch when the PUT fails', async () => {
      useTaskStore.setState({
        taskDetailMap: {
          'T-1': {
            ...useTaskStore.getState().taskDetailMap['T-1'],
            schedule: { pattern: '0 9 * * *', timezone: 'UTC' },
          },
        },
      });

      vi.mocked(taskService.update).mockRejectedValue(new Error('boom'));

      await useTaskStore.getState().updateSchedule('T-1', {
        maxExecutions: 10,
        pattern: '0 11 * * 1',
        timezone: 'Asia/Shanghai',
      });

      const detail = useTaskStore.getState().taskDetailMap['T-1'];
      expect(detail.schedule?.pattern).toBe('0 9 * * *');
      expect(detail.schedule?.timezone).toBe('UTC');
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
