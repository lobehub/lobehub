// @vitest-environment node
import type { TaskItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

const fakeScheduler = {
  cancelScheduled: vi.fn().mockResolvedValue(undefined),
  scheduleNextTopic: vi.fn().mockResolvedValue('msg-new'),
};

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => fakeScheduler,
}));

const baseTask = (overrides: Partial<TaskItem> = {}): TaskItem =>
  ({
    automationMode: 'heartbeat',
    config: {},
    context: {},
    error: null,
    heartbeatInterval: 30,
    heartbeatTimeout: 600,
    id: 'task-1',
    identifier: 'TASK-1',
    instruction: 'do the thing',
    name: 'demo',
    status: 'running',
    ...overrides,
  }) as unknown as TaskItem;

describe('TaskLifecycleService.onTopicComplete', () => {
  let service: TaskLifecycleService;
  let updateStatus: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let updateHeartbeat: ReturnType<typeof vi.fn>;
  let updateTopicStatus: ReturnType<typeof vi.fn>;
  let createBrief: ReturnType<typeof vi.fn>;
  let getReviewConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeScheduler.scheduleNextTopic.mockClear().mockResolvedValue('msg-new');

    service = new TaskLifecycleService({} as any, 'user-1');

    updateStatus = vi.fn().mockResolvedValue(null);
    findById = vi.fn();
    updateHeartbeat = vi.fn().mockResolvedValue(undefined);
    updateTopicStatus = vi.fn().mockResolvedValue(undefined);
    createBrief = vi.fn().mockResolvedValue(undefined);
    getReviewConfig = vi.fn().mockReturnValue(undefined);

    const taskModel = (service as any).taskModel;
    taskModel.updateStatus = updateStatus;
    taskModel.findById = findById;
    taskModel.updateHeartbeat = updateHeartbeat;
    taskModel.getReviewConfig = getReviewConfig;
    // Default checkpoint behavior: pause after topic complete
    taskModel.shouldPauseOnTopicComplete = vi.fn().mockReturnValue(true);
    // Avoid generateHandoff side effects by skipping when lastAssistantContent is undefined
    (service as any).taskTopicModel.updateStatus = updateTopicStatus;
    (service as any).briefModel.create = createBrief;
    (service as any).briefModel.hasUnresolvedUrgentByTask = vi.fn().mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reason=done', () => {
    it('automation task → status="scheduled" (not paused)', async () => {
      const task = baseTask({ automationMode: 'heartbeat' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: null });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
    });

    it('schedule-mode task → status="scheduled"', async () => {
      const task = baseTask({ automationMode: 'schedule' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: null });
    });

    it('schedule-mode task under maxExecutions still parks at "scheduled"', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        config: { schedule: { maxExecutions: 10 } } as any,
        context: {
          scheduler: { scheduleStartedAt: new Date('2026-05-01T00:00:00Z').toISOString() },
        } as any,
      });
      findById.mockResolvedValue(task);
      (service as any).taskTopicModel.countByTask = vi.fn().mockResolvedValue(3);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: null });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'completed', expect.anything());
    });

    it('schedule-mode task at maxExecutions parks at "completed" instead of "scheduled"', async () => {
      // The reviewer-flagged P2 case: a daily cron with maxExecutions=1
      // would otherwise sit in `scheduled` for 24h after the only allowed
      // tick before the next pre-tick check noticed the cap.
      const task = baseTask({
        automationMode: 'schedule',
        config: { schedule: { maxExecutions: 1 } } as any,
        context: {
          scheduler: { scheduleStartedAt: new Date('2026-05-01T00:00:00Z').toISOString() },
        } as any,
      });
      findById.mockResolvedValue(task);
      (service as any).taskTopicModel.countByTask = vi.fn().mockResolvedValue(1);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'completed', {
        completedAt: expect.any(Date),
      });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'scheduled', expect.anything());
    });

    it('schedule-mode task with no scheduleStartedAt (pre-PR) still parks at "scheduled"', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        config: { schedule: { maxExecutions: 1 } } as any,
        context: {} as any,
      });
      findById.mockResolvedValue(task);
      const countByTask = vi.fn().mockResolvedValue(99);
      (service as any).taskTopicModel.countByTask = countByTask;

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      // Without scheduleStartedAt the helper short-circuits before querying,
      // and the task falls through to the normal scheduled-park branch.
      expect(countByTask).not.toHaveBeenCalled();
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: null });
    });

    it('non-automation task with default checkpoint → status="paused" (legacy behavior)', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: null });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'scheduled', expect.anything());
    });

    it('non-automation task with shouldPauseOnTopicComplete=false → no status update', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);
      (service as any).taskModel.shouldPauseOnTopicComplete = vi.fn().mockReturnValue(false);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('reason=done with brief.mode', () => {
    it('calls synthesizeTopicBrief by default (auto mode) when content is substantive', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);
      const synthesize = vi
        .spyOn(service as any, 'synthesizeTopicBrief')
        .mockResolvedValue(undefined);
      vi.spyOn(service as any, 'generateHandoff').mockResolvedValue(undefined);

      await service.onTopicComplete({
        lastAssistantContent:
          'I have completed the analysis and produced a multi-page report covering all sections.',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(synthesize).toHaveBeenCalledTimes(1);
    });

    it('does not call synthesizeTopicBrief when brief.mode=agent (legacy escape hatch)', async () => {
      const task = baseTask({
        automationMode: null,
        config: { brief: { mode: 'agent' } },
      });
      findById.mockResolvedValue(task);
      const synthesize = vi
        .spyOn(service as any, 'synthesizeTopicBrief')
        .mockResolvedValue(undefined);
      vi.spyOn(service as any, 'generateHandoff').mockResolvedValue(undefined);

      await service.onTopicComplete({
        lastAssistantContent: 'enough content to count as substantive output',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(synthesize).not.toHaveBeenCalled();
    });

    it('does not call synthesizeTopicBrief when judge terminates (review enabled + passed)', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);
      // runAutoReview returns true → onTopicComplete returns early before
      // reaching synthesizeTopicBrief.
      vi.spyOn(service as any, 'runAutoReview').mockResolvedValue(true);
      const synthesize = vi
        .spyOn(service as any, 'synthesizeTopicBrief')
        .mockResolvedValue(undefined);
      vi.spyOn(service as any, 'generateHandoff').mockResolvedValue(undefined);

      await service.onTopicComplete({
        lastAssistantContent: 'enough content to count as substantive output',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(synthesize).not.toHaveBeenCalled();
    });
  });

  describe('reason=error', () => {
    it('automation task → status="paused" (error always pauses)', async () => {
      const task = baseTask({ automationMode: 'heartbeat' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused');
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'scheduled', expect.anything());
    });

    it('non-automation task → status="paused" (unchanged behavior)', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused');
    });
  });
});
