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
