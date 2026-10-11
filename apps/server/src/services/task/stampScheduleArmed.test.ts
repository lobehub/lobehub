// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Service deps are mocked wholesale — this suite exercises the stamping gate
// logic only (T-634: arming a backlog task must stamp the run-count window
// without a status transition, and must never reset an existing window).
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/goalGraph', () => ({ GoalGraphModel: vi.fn() }));
vi.mock('@/database/models/project', () => ({ ProjectModel: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: vi.fn() }));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
  taskActivityActor: (actor: { agentId?: string | null; userId?: string | null }) => ({
    actorAgentId: actor.agentId ?? null,
    actorKind: actor.agentId ? 'agent' : actor.userId ? 'user' : 'system',
    actorUserId: actor.agentId ? null : (actor.userId ?? null),
  }),
}));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: { findByIds: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/database/models/verifyRun', () => ({ VerifyRunModel: vi.fn() }));
vi.mock('@/database/models/workspaceMember', () => ({ WorkspaceMemberModel: vi.fn() }));
vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('../aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('../file/extractFileIdsFromEditorData', () => ({
  extractFileIdsFromEditorData: vi.fn().mockResolvedValue([]),
}));
vi.mock('../file/resolveAttachments', () => ({
  resolveAttachmentMetadata: vi.fn().mockResolvedValue([]),
}));
vi.mock('../taskGraph', () => ({ TaskGraphService: vi.fn() }));
vi.mock('../taskReview', () => ({ TaskReviewService: vi.fn() }));
vi.mock('../taskRunner', () => ({ TaskRunnerService: vi.fn() }));
vi.mock('../taskScheduler', () => ({
  createTaskSchedulerModule: () => ({ cancelScheduled: vi.fn(), scheduleNextTopic: vi.fn() }),
}));
vi.mock('../verify/taskAcceptance', () => ({ resolveTaskAcceptance: vi.fn() }));

import { TaskModel } from '@/database/models/task';

import { TaskService } from './index';

const userId = 'user-1';
const db = {} as any;

const mockTaskModel = {
  updateContext: vi.fn(),
};

describe('stampScheduleArmedOnColumnWrite / T-634 arming window', () => {
  const stampTask = (overrides: Record<string, unknown> = {}) => ({
    automationMode: 'schedule',
    context: {},
    id: 'task-1',
    schedulePattern: '0 10 27 9 *',
    status: 'backlog',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (TaskModel as any).mockImplementation(function () {
      return mockTaskModel;
    });
  });

  it('stamps scheduleStartedAt on a backlog task armed without a status transition', async () => {
    const service = new TaskService(db, userId);
    await service.stampScheduleArmedOnColumnWrite(stampTask() as any);

    expect(mockTaskModel.updateContext).toHaveBeenCalledTimes(1);
    expect(mockTaskModel.updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: { scheduleStartedAt: expect.any(String) },
    });
    const stamped = (mockTaskModel.updateContext.mock.calls[0]![1] as any).scheduler
      .scheduleStartedAt as string;
    expect(() => new Date(stamped).toISOString()).not.toThrow();
  });

  it('does not reset an existing quota window on re-arm', async () => {
    const service = new TaskService(db, userId);
    await service.stampScheduleArmedOnColumnWrite(
      stampTask({ context: { scheduler: { scheduleStartedAt: '2026-09-20T06:00:00.000Z' } } }) as any,
    );

    expect(mockTaskModel.updateContext).not.toHaveBeenCalled();
  });

  it('skips tasks that are not in schedule mode or lack a pattern', async () => {
    const service = new TaskService(db, userId);
    await service.stampScheduleArmedOnColumnWrite(stampTask({ automationMode: 'heartbeat' }) as any);
    await service.stampScheduleArmedOnColumnWrite(stampTask({ schedulePattern: null }) as any);

    expect(mockTaskModel.updateContext).not.toHaveBeenCalled();
  });

  it('skips non-dispatchable statuses', async () => {
    const service = new TaskService(db, userId);
    for (const status of ['running', 'paused', 'completed', 'failed', 'canceled']) {
      await service.stampScheduleArmedOnColumnWrite(stampTask({ status }) as any);
    }

    expect(mockTaskModel.updateContext).not.toHaveBeenCalled();
  });
});
