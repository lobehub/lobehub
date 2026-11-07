// @vitest-environment node
import type { TaskItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

const fakeScheduler = {
  cancelScheduled: vi.fn().mockResolvedValue(undefined),
  scheduleNextTopic: vi.fn().mockResolvedValue('msg-new'),
};

const { cascadeOnCompletion } = vi.hoisted(() => ({
  cascadeOnCompletion: vi.fn().mockResolvedValue({ failed: [], paused: [], started: [] }),
}));

vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn(function () {
    return { cascadeOnCompletion };
  }),
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => fakeScheduler,
}));

// onTopicComplete reads the op's verify run to decide whether to "let go" for
// async Verify-driven completion. Mock it; default = no verify run.
const verifyFindByOperation = vi.fn().mockResolvedValue(undefined);
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: verifyFindByOperation };
  }),
}));

// Goal-loop rounds suppress the per-topic brief; onTopicComplete asks the
// goals table whether this task carries a goal. Default = plain task.
const goalFindByGraphTask = vi.fn().mockResolvedValue(undefined);
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask: goalFindByGraphTask };
  }),
}));

// Scheduled-task result notifications go through the `@/business` slot
// (default impl is a no-op). Mock both hooks so the tests can assert exactly
// when the lifecycle recalls the user.
const notifyCompleted = vi.fn().mockResolvedValue(undefined);
const notifyFailed = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/notifyScheduledTaskResult', () => ({
  notifyScheduledTaskCompleted: (...args: unknown[]) => notifyCompleted(...args),
  notifyScheduledTaskFailed: (...args: unknown[]) => notifyFailed(...args),
}));
const notifyRunFailed = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/notifyTaskRunFailed', () => ({
  notifyTaskRunFailed: (...args: unknown[]) => notifyRunFailed(...args),
}));
const runCompleted = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/onTaskRunCompleted', () => ({
  onTaskRunCompleted: (...args: unknown[]) => runCompleted(...args),
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
  let updateStatusIfCurrent: ReturnType<typeof vi.fn>;
  let completeIfCompletionRequested: ReturnType<typeof vi.fn>;
  let updateContext: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let updateHeartbeat: ReturnType<typeof vi.fn>;
  let updateTopicStatus: ReturnType<typeof vi.fn>;
  let createBrief: ReturnType<typeof vi.fn>;
  let getReviewConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeScheduler.scheduleNextTopic.mockClear().mockResolvedValue('msg-new');
    notifyCompleted.mockReset().mockResolvedValue(undefined);
    notifyFailed.mockReset().mockResolvedValue(undefined);
    notifyRunFailed.mockReset().mockResolvedValue(undefined);
    runCompleted.mockReset().mockResolvedValue(undefined);
    cascadeOnCompletion.mockReset().mockResolvedValue({ failed: [], paused: [], started: [] });

    service = new TaskLifecycleService({} as any, 'user-1');

    updateStatus = vi.fn().mockResolvedValue(null);
    updateStatusIfCurrent = vi.fn();
    completeIfCompletionRequested = vi.fn();
    updateContext = vi.fn().mockResolvedValue(null);
    findById = vi.fn();
    updateHeartbeat = vi.fn().mockResolvedValue(undefined);
    updateTopicStatus = vi.fn().mockResolvedValue(undefined);
    createBrief = vi.fn().mockResolvedValue(undefined);
    getReviewConfig = vi.fn().mockReturnValue(undefined);
    verifyFindByOperation.mockReset().mockResolvedValue(undefined);

    const taskModel = (service as any).taskModel;
    taskModel.updateStatus = updateStatus;
    taskModel.updateStatusIfCurrent = updateStatusIfCurrent;
    taskModel.completeIfCompletionRequested = completeIfCompletionRequested;
    taskModel.updateContext = updateContext;
    taskModel.findById = findById;
    taskModel.updateHeartbeat = updateHeartbeat;
    taskModel.getReviewConfig = getReviewConfig;
    taskModel.getCheckpointConfig = vi.fn().mockReturnValue({});
    // Default checkpoint behavior: pause after topic complete
    taskModel.shouldPauseOnTopicComplete = vi.fn().mockReturnValue(true);
    // Avoid generateHandoff side effects by skipping when lastAssistantContent is undefined
    (service as any).taskTopicModel.updateStatus = updateTopicStatus;
    (service as any).taskTopicModel.updateHandoffContent = vi.fn().mockResolvedValue(undefined);
    (service as any).briefModel.create = createBrief;
    (service as any).briefModel.hasUnresolvedUrgentByTask = vi.fn().mockResolvedValue(false);
    // The error branch resolves the user's locale for brief copy.
    (service as any).systemAgentService.getUserLocale = vi.fn().mockResolvedValue('en-US');
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

    it('persists the run last message independently of handoff summary', async () => {
      const task = baseTask({ automationMode: 'heartbeat' });
      findById.mockResolvedValue(task);
      // Model the summary path as a no-op (e.g. its LLM call failed and was
      // swallowed) — the raw last message must still be persisted for the card.
      vi.spyOn(service as any, 'generateHandoff').mockResolvedValue(undefined);
      const updateHandoffContent = (service as any).taskTopicModel.updateHandoffContent;

      await service.onTopicComplete({
        lastAssistantContent: 'the raw last assistant message',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateHandoffContent).toHaveBeenCalledWith(
        'task-1',
        'topic-1',
        'the raw last assistant message',
      );
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

    it('finalizes a current-operation completion request after the topic completes', async () => {
      const task = baseTask({
        automationMode: null,
        context: { completion: { requestedByOperationId: 'op-1' } },
      });
      completeIfCompletionRequested.mockResolvedValue({ ...task, status: 'completed' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      // The request is consumed by the same write that completes the task.
      expect(completeIfCompletionRequested).toHaveBeenCalledWith('task-1', 'op-1');
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
      expect(cascadeOnCompletion).toHaveBeenCalledWith('task-1');
    });

    it('pauses for review when the request was withdrawn while the topic was settling', async () => {
      // A rejected acceptance delivery withdrew the request after the task was first read.
      const task = baseTask({
        automationMode: null,
        context: { completion: { requestedByOperationId: 'op-1' } },
      });
      findById.mockResolvedValue(task);
      completeIfCompletionRequested.mockResolvedValue(null);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(cascadeOnCompletion).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'paused', {
        error: null,
      });
    });

    it.each(['schedule', 'heartbeat'] as const)(
      '%s task whose own tick met the end condition → completed instead of re-armed',
      async (automationMode) => {
        const task = baseTask({
          automationMode,
          context: { completion: { requestedByOperationId: 'op-1' } },
        });
        updateStatusIfCurrent.mockResolvedValue({ ...task, status: 'completed' });
        findById.mockResolvedValueOnce(task).mockResolvedValue({ ...task, status: 'completed' });

        await service.onTopicComplete({
          operationId: 'op-1',
          reason: 'done',
          runTrigger: automationMode,
          taskId: 'task-1',
          taskIdentifier: 'TASK-1',
          topicId: 'topic-1',
        });

        expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'completed', {
          completedAt: expect.any(Date),
          error: null,
        });
        expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'scheduled', expect.anything());
        expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
        expect(cascadeOnCompletion).toHaveBeenCalledWith('task-1');
      },
    );

    it('automation task ignores a completion request left by an earlier tick', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { completion: { requestedByOperationId: 'op-old' } },
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: null });
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('successful subtask → completes and unlocks downstream tasks instead of pausing', async () => {
      const task = baseTask({ automationMode: null, parentTaskId: 'parent-task' });
      const parentTask = baseTask({ id: 'parent-task', identifier: 'TASK-0' });
      updateStatusIfCurrent.mockResolvedValue(task);
      findById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(parentTask)
        .mockResolvedValue(task);
      (service as any).taskModel.shouldPauseAfterComplete = vi.fn().mockReturnValue(false);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'completed', {
        completedAt: expect.any(Date),
        error: null,
      });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
      expect(cascadeOnCompletion).toHaveBeenCalledWith('task-1');
    });

    it.each([null, 'schedule', 'heartbeat'] as const)(
      'successful %s subtask still honors an explicit parent after-completion checkpoint',
      async (automationMode) => {
        const task = baseTask({
          automationMode,
          context: automationMode ? { completion: { requestedByOperationId: 'op-1' } } : {},
          parentTaskId: 'parent-task',
        });
        const parentTask = baseTask({ id: 'parent-task', identifier: 'TASK-0' });
        updateStatusIfCurrent.mockResolvedValue(task);
        findById
          .mockResolvedValueOnce(task)
          .mockResolvedValueOnce(parentTask)
          .mockResolvedValue(task);
        (service as any).taskModel.shouldPauseAfterComplete = vi.fn().mockReturnValue(true);

        await service.onTopicComplete({
          operationId: 'op-1',
          reason: 'done',
          taskId: 'task-1',
          taskIdentifier: 'TASK-1',
          topicId: 'topic-1',
        });

        expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'completed', {
          completedAt: expect.any(Date),
          error: null,
        });
        expect(updateStatus).toHaveBeenCalledWith('parent-task', 'paused');
        expect(cascadeOnCompletion).toHaveBeenCalledWith('task-1');
      },
    );

    it('successful subtask with an explicit topic-after checkpoint → pauses for review', async () => {
      const task = baseTask({ automationMode: null, parentTaskId: 'parent-task' });
      findById.mockResolvedValue(task);
      (service as any).taskModel.getCheckpointConfig = vi
        .fn()
        .mockReturnValue({ topic: { after: true } });

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'paused', {
        error: null,
      });
      expect(cascadeOnCompletion).not.toHaveBeenCalled();
    });

    it.each([null, 'schedule', 'heartbeat'] as const)(
      'late successful callback does not overwrite a %s child that is no longer running',
      async (automationMode) => {
        const task = baseTask({
          automationMode,
          context: automationMode ? { completion: { requestedByOperationId: 'op-1' } } : {},
          parentTaskId: 'parent-task',
        });
        findById.mockResolvedValue(task);
        updateStatusIfCurrent.mockResolvedValue(null);

        await service.onTopicComplete({
          operationId: 'op-1',
          reason: 'done',
          taskId: 'task-1',
          taskIdentifier: 'TASK-1',
          topicId: 'topic-1',
        });

        expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'completed', {
          completedAt: expect.any(Date),
          error: null,
        });
        expect(cascadeOnCompletion).not.toHaveBeenCalled();
      },
    );

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

    it('goal-owned root task completes instead of remaining running', async () => {
      const task = baseTask({ automationMode: null, parentTaskId: null });
      findById.mockResolvedValue(task);
      (service as any).taskModel.shouldPauseOnTopicComplete = vi.fn().mockReturnValue(false);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        runTrigger: 'goal',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatusIfCurrent).toHaveBeenCalledWith('task-1', 'running', 'completed', {
        completedAt: expect.any(Date),
        error: null,
      });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
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

    it('verify-bound task → does NOT pause-for-review (lets Verify drive completion async)', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);
      // A confirmed verify run exists for this op → onTopicComplete "lets go".
      verifyFindByOperation.mockResolvedValue({ planConfirmedAt: new Date() });
      vi.spyOn(service as any, 'synthesizeTopicBrief').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'generateHandoff').mockResolvedValue(undefined);
      const bridge = vi.spyOn(service as any, 'bridgeResultToCreator').mockResolvedValue(undefined);

      await service.onTopicComplete({
        lastAssistantContent: 'enough content to count as substantive output',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      // Did not pause — driveTaskFromVerify will complete/pause the task on settle.
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
      // The creator callback is DEFERRED to the verify settle path, not fired here.
      expect(bridge).not.toHaveBeenCalled();
    });

    it('non-verify-bound task → fires the creator callback at onTopicComplete', async () => {
      const task = baseTask({ automationMode: null });
      findById.mockResolvedValue(task);
      verifyFindByOperation.mockResolvedValue(undefined); // no verify run
      vi.spyOn(service as any, 'synthesizeTopicBrief').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'generateHandoff').mockResolvedValue(undefined);
      const bridge = vi.spyOn(service as any, 'bridgeResultToCreator').mockResolvedValue(undefined);

      await service.onTopicComplete({
        lastAssistantContent: 'enough content to count as substantive output',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(bridge).toHaveBeenCalledTimes(1);
    });
  });

  describe('reason=error', () => {
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

      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: 'boom' });
    });

    it('manual run of a schedule task fails → restored to scheduled, NOT paused', async () => {
      const task = baseTask({ automationMode: 'schedule', status: 'running' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'manual',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      // Restored to the resting scheduled state so the next cron tick still
      // fires — never paused off the schedule.
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: 'boom' });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
      // Manual failure must NOT touch the consecutive-failure fuse.
      expect(updateContext).not.toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ scheduler: expect.anything() }),
      );
    });

    it('undefined runTrigger defaults to manual (backward compat)', async () => {
      const task = baseTask({ automationMode: 'schedule' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: 'boom' });
    });

    it('scheduled run fails below fuse → stays scheduled + increments failures', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { scheduler: { consecutiveFailures: 1 } } as any,
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      // 1 prior + this one = 2, below the fuse of 3 → retryable, stays scheduled.
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: 'boom' });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'paused', expect.anything());
      expect(updateContext).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ scheduler: { consecutiveFailures: 2 } }),
      );
    });

    it('scheduled run fails AT fuse → pauses for human attention', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { scheduler: { consecutiveFailures: 2 } } as any,
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      // 2 prior + this one = 3 = fuse → pause.
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: 'boom' });
      // Audit trail records the pause reason durably.
      expect(updateContext).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          lifecycle: expect.objectContaining({ lastPausedAt: expect.any(String) }),
          scheduler: { consecutiveFailures: 3 },
        }),
      );
    });

    it('every error appends to the durable lifecycle audit trail', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { lifecycle: { errorCount: 4 } } as any,
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateContext).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          lifecycle: expect.objectContaining({
            errorCount: 5,
            lastError: expect.objectContaining({ message: 'boom', trigger: 'schedule' }),
          }),
        }),
      );
    });

    // Failures are not decisions: they go to the notification center, never to
    // a "Needs you" error brief.
    it('a failed run notifies instead of creating an error brief', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: null }));

      await service.onTopicComplete({
        errorCode: 'InsufficientBudgetForModel',
        errorMessage: 'Workspace budget exceeded',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'manual',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(createBrief).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      // Only the structured code crosses the slot — raw error text stays on the task.
      expect(notifyRunFailed).toHaveBeenCalledWith({
        agentId: undefined,
        errorCode: 'InsufficientBudgetForModel',
        operationId: 'op-1',
        reason: 'error',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        taskName: 'demo',
        topicId: 'topic-1',
        userId: 'user-1',
        workspaceId: undefined,
      });
    });

    // A Goal Task's failed run is the coordinator's to recover, and the gate it
    // opens is what the person gets — a failure notification per run would ask
    // them to act on something the goal was already handling.
    it('leaves a Goal Task failure to the coordinator', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: null }));

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'goal',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(createBrief).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      expect(notifyRunFailed).not.toHaveBeenCalled();
      expect(notifyFailed).not.toHaveBeenCalled();
    });

    // Only the coordinator's own runs are recovered by it: a manual rerun of a
    // Task kept under a paused or finished goal has nobody watching it.
    it('still notifies for a manual rerun of a Goal Task', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: null }));

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'manual',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyRunFailed).toHaveBeenCalledOnce();
    });

    it('does not notify for a task deleted mid-run', async () => {
      findById.mockResolvedValue(null);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'manual',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyRunFailed).not.toHaveBeenCalled();
    });
  });

  describe('reason=done recovery audit ', () => {
    it('successful automation tick after an error stamps lastRecoveredAt + resets fuse', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { scheduler: { consecutiveFailures: 2 } } as any,
        error: 'previous boom',
        status: 'running',
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateContext).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          lifecycle: expect.objectContaining({ lastRecoveredAt: expect.any(String) }),
          scheduler: { consecutiveFailures: 0 },
        }),
      );
      // Live error still cleared so the UI shows a clean current state.
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'scheduled', { error: null });
    });

    it('successful automation tick with no prior error does NOT write a recovery marker', async () => {
      const task = baseTask({ automationMode: 'schedule', context: {} as any, error: null });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(updateContext).not.toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ lifecycle: expect.anything() }),
      );
    });
  });

  describe('run-completed follow-up', () => {
    it('runs after the status has settled, with the run identity', async () => {
      findById.mockResolvedValue(
        baseTask({ assigneeAgentId: 'agent-1', automationMode: null } as Partial<TaskItem>),
      );

      await service.onTopicComplete({
        lastAssistantContent: 'final reply',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(runCompleted).toHaveBeenCalledWith({
        agentId: 'agent-1',
        lastAssistantContent: 'final reply',
        operationId: 'op-1',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
        userId: 'user-1',
        workspaceId: undefined,
      });
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: null });
      expect(updateStatus.mock.invocationCallOrder[0]).toBeLessThan(
        runCompleted.mock.invocationCallOrder[0],
      );
    });

    it('a failing follow-up does not fail the lifecycle', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: null } as Partial<TaskItem>));
      runCompleted.mockRejectedValue(new Error('boom'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        service.onTopicComplete({
          operationId: 'op-1',
          reason: 'done',
          taskId: 'task-1',
          taskIdentifier: 'TASK-1',
          topicId: 'topic-1',
        }),
      ).resolves.toBeUndefined();
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: null });
      // Logged where production sees it: the follow-up can change task state.
      expect(consoleError).toHaveBeenCalled();
    });

    it('is not called when the run failed', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: null } as Partial<TaskItem>));

      await service.onTopicComplete({
        errorMessage: 'upstream 500',
        operationId: 'op-1',
        reason: 'error',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(runCompleted).not.toHaveBeenCalled();
    });
  });

  describe('scheduled-task result notifications', () => {
    it('successful scheduled tick → completed notification with task identity', async () => {
      const task = baseTask({ automationMode: 'schedule', name: 'Daily digest' });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'op-1',
          taskId: 'task-1',
          taskIdentifier: 'TASK-1',
          taskName: 'Daily digest',
          topicId: 'topic-1',
          userId: 'user-1',
        }),
      );
      expect(notifyFailed).not.toHaveBeenCalled();
    });

    it('manual run and heartbeat tick success → NO completed notification', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: 'schedule' }));
      await service.onTopicComplete({
        operationId: 'op-1',
        reason: 'done',
        runTrigger: 'manual',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      findById.mockResolvedValue(baseTask({ automationMode: 'heartbeat' }));
      await service.onTopicComplete({
        operationId: 'op-2',
        reason: 'done',
        runTrigger: 'heartbeat',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyCompleted).not.toHaveBeenCalled();
    });

    it('scheduled tick failure below fuse → failed notification, not paused', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { scheduler: { consecutiveFailures: 0 } } as any,
        name: 'Daily digest',
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorCode: 'InsufficientBudgetForModel',
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveFailures: 1,
          errorCode: 'InsufficientBudgetForModel',
          paused: false,
          runTrigger: 'schedule',
          taskName: 'Daily digest',
          userId: 'user-1',
        }),
      );
      // The raw error text must never cross the slot boundary.
      expect(JSON.stringify(notifyFailed.mock.calls[0][0])).not.toContain('boom');
      expect(notifyCompleted).not.toHaveBeenCalled();
    });

    it('scheduled tick failure that blows the fuse → paused failed notification', async () => {
      const task = baseTask({
        automationMode: 'schedule',
        context: { scheduler: { consecutiveFailures: 2 } } as any,
      });
      findById.mockResolvedValue(task);

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'schedule',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyFailed).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailures: 3, paused: true }),
      );
    });

    it('manual failure of an automation task → run-failed notification, not an automation one', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: 'schedule' }));

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'manual',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyFailed).not.toHaveBeenCalled();
      expect(notifyRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'error', taskId: 'task-1' }),
      );
    });

    it('transient heartbeat tick failure → NO notification (high-frequency ticks)', async () => {
      findById.mockResolvedValue(baseTask({ automationMode: 'heartbeat' }));

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'heartbeat',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyFailed).not.toHaveBeenCalled();
    });

    it('heartbeat failure that blows the fuse → paused failed notification', async () => {
      findById.mockResolvedValue(
        baseTask({
          automationMode: 'heartbeat',
          context: { scheduler: { consecutiveFailures: 2 } } as any,
        }),
      );

      await service.onTopicComplete({
        errorMessage: 'boom',
        operationId: 'op-1',
        reason: 'error',
        runTrigger: 'heartbeat',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
        topicId: 'topic-1',
      });

      expect(notifyFailed).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailures: 3, paused: true, runTrigger: 'heartbeat' }),
      );
      expect(updateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: 'boom' });
      expect(updateStatus).not.toHaveBeenCalledWith('task-1', 'scheduled', expect.anything());
    });
  });
});
