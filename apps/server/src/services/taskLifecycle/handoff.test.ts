// @vitest-environment node
import type { TaskItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({ generateObject }),
}));
vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => ({ cancelScheduled: vi.fn(), scheduleNextTopic: vi.fn() }),
}));
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn(function () {
    return {
      cascadeOnCompletion: vi.fn().mockResolvedValue({ failed: [], paused: [], started: [] }),
    };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: vi.fn().mockResolvedValue(undefined) };
  }),
}));
// A Goal task, so the per-topic brief stays out of the way.
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask: vi.fn().mockResolvedValue({ id: 'goal-1' }) };
  }),
}));

const report = `# Verification passed\n\n${'Every path reopened within 500 ms. '.repeat(20)}`;
const remark =
  'The background file search from earlier has finished. I had already used its output, so the verification results are unchanged.';

const task = {
  automationMode: null,
  config: {},
  context: {},
  id: 'task-1',
  identifier: 'T-1',
  instruction: 'Verify the hover fix',
  name: 'Hover re-verification',
  parentTaskId: null,
  status: 'running',
} as unknown as TaskItem;

describe('TaskLifecycleService handoff', () => {
  let service: TaskLifecycleService;
  let updateHandoff: ReturnType<typeof vi.fn>;
  let updateHandoffContent: ReturnType<typeof vi.fn>;
  let listLatestTurnAssistantContents: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    generateObject.mockReset();
    service = new TaskLifecycleService({} as any, 'user-1');

    const taskModel = (service as any).taskModel;
    taskModel.findById = vi.fn().mockResolvedValue(task);
    taskModel.updateHeartbeat = vi.fn();
    taskModel.updateStatusIfCurrent = vi.fn();
    taskModel.getCheckpointConfig = vi.fn().mockReturnValue({});
    taskModel.shouldPauseOnTopicComplete = vi.fn().mockReturnValue(false);

    updateHandoff = vi.fn();
    updateHandoffContent = vi.fn();
    (service as any).taskTopicModel.updateStatus = vi.fn();
    (service as any).taskTopicModel.updateHandoff = updateHandoff;
    (service as any).taskTopicModel.updateHandoffContent = updateHandoffContent;
    (service as any).topicModel.update = vi.fn();

    listLatestTurnAssistantContents = vi
      .fn()
      .mockResolvedValue([{ content: remark }, { content: report }]);
    (service as any).messageModel.listLatestTurnAssistantContents = listLatestTurnAssistantContents;

    const systemAgent = (service as any).systemAgentService;
    systemAgent.getTaskModelConfig = vi.fn().mockResolvedValue({ model: 'm', provider: 'p' });
    systemAgent.getUserLocale = vi.fn().mockResolvedValue('zh-CN');
  });

  const complete = () =>
    service.onTopicComplete({
      lastAssistantContent: remark,
      operationId: 'op-1',
      reason: 'done',
      runTrigger: 'goal',
      taskId: 'task-1',
      taskIdentifier: 'T-1',
      topicId: 'topic-1',
    });

  /**
   * Regression: a run delivered its report, then a finished
   * background job woke it for one remark. The handoff (and so the Goal
   * finding) said nothing was delivered, and the coordinator re-ran the whole
   * verification as a new Task.
   */
  it('keeps the earlier report as the run output when the last reply is a trailing remark', async () => {
    generateObject.mockResolvedValue({
      finalIsTrailingRemark: true,
      keyFindings: [],
      nextAction: '',
      summary: 'All five checks passed on a real run',
      title: 'Hover fix verified',
    });

    await complete();

    const userPrompt = generateObject.mock.calls[0][0].messages[1].content as string;
    expect(userPrompt).toContain(`Earlier report from this run:\n${report.trim()}`);
    expect(updateHandoff).toHaveBeenCalledWith('task-1', 'topic-1', {
      keyFindings: [],
      nextAction: '',
      summary: 'All five checks passed on a real run',
      title: 'Hover fix verified',
    });
    expect(updateHandoffContent).toHaveBeenCalledWith('task-1', 'topic-1', report.trim());
  });

  it('keeps the last reply when it reports its own outcome', async () => {
    generateObject.mockResolvedValue({
      finalIsTrailingRemark: false,
      keyFindings: [],
      nextAction: '',
      summary: 's',
      title: 't',
    });

    await complete();

    expect(updateHandoffContent).toHaveBeenCalledWith('task-1', 'topic-1', remark);
  });

  it('falls back to the last reply when the run lookup fails', async () => {
    listLatestTurnAssistantContents.mockRejectedValue(new Error('db down'));
    generateObject.mockResolvedValue({
      finalIsTrailingRemark: true,
      keyFindings: [],
      nextAction: '',
      summary: 's',
      title: 't',
    });

    await complete();

    const userPrompt = generateObject.mock.calls[0][0].messages[1].content as string;
    expect(userPrompt).not.toContain('Earlier report');
    expect(updateHandoffContent).toHaveBeenCalledWith('task-1', 'topic-1', remark);
  });
});
