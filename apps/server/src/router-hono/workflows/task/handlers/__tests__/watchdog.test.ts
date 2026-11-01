import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { watchdog } from '../watchdog';

const mocks = vi.hoisted(() => ({
  briefCreate: vi.fn(),
  findRecoverableScopes: vi.fn(),
  findStuckTasks: vi.fn(),
  getServerDB: vi.fn(),
  notifyTaskRunFailed: vi.fn(),
  reconcileOrphanedTaskRuns: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: mocks.getServerDB }));

vi.mock('@/database/models/task', () => ({
  TaskModel: Object.assign(
    vi.fn(function () {
      return { updateStatus: mocks.updateStatus };
    }),
    { findStuckTasks: mocks.findStuckTasks },
  ),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(function () {
    return { create: mocks.briefCreate };
  }),
}));

vi.mock('@/business/server/task/notifyTaskRunFailed', () => ({
  notifyTaskRunFailed: mocks.notifyTaskRunFailed,
}));

vi.mock('@/server/services/taskLifecycle/reconcile', () => ({
  reconcileOrphanedTaskRuns: mocks.reconcileOrphanedTaskRuns,
}));

vi.mock('@/server/services/taskResultBridge', () => ({ TaskResultBridgeService: vi.fn() }));

vi.mock('@/server/services/taskResultBridge/redisStore', () => ({
  TaskResultCallbackRedisStore: { findRecoverableScopes: mocks.findRecoverableScopes },
}));

const runWatchdog = async () => {
  const app = new Hono();
  app.post('/watchdog', watchdog);
  const res = await app.request('/watchdog', { method: 'POST' });
  return { body: await res.json(), status: res.status };
};

describe('task watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({});
    mocks.findRecoverableScopes.mockResolvedValue([]);
    mocks.notifyTaskRunFailed.mockResolvedValue(undefined);
    mocks.reconcileOrphanedTaskRuns.mockResolvedValue({ converged: [] });
  });

  // A heartbeat timeout is a failure, not a decision: it goes to the
  // notification center rather than a "Needs you" error brief.
  it('fails a stuck task and notifies instead of creating an error brief', async () => {
    mocks.findStuckTasks.mockResolvedValue([
      {
        assigneeAgentId: 'agent-1',
        createdByUserId: 'user-1',
        heartbeatTimeout: 600,
        id: 'task-1',
        identifier: 'T-1',
        name: 'Nightly sync',
        workspaceId: 'ws-1',
      },
    ]);

    const { body, status } = await runWatchdog();

    expect(status).toBe(200);
    expect(body.failed).toEqual(['T-1']);
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      'task-1',
      'failed',
      expect.objectContaining({ error: 'Heartbeat timeout' }),
    );
    expect(mocks.briefCreate).not.toHaveBeenCalled();
    expect(mocks.notifyTaskRunFailed).toHaveBeenCalledWith({
      agentId: 'agent-1',
      reason: 'heartbeat_timeout',
      taskId: 'task-1',
      taskIdentifier: 'T-1',
      taskName: 'Nightly sync',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('keeps sweeping when the notification fails', async () => {
    mocks.findStuckTasks.mockResolvedValue([
      { createdByUserId: 'user-1', id: 'task-1', identifier: 'T-1', workspaceId: null },
    ]);
    mocks.notifyTaskRunFailed.mockRejectedValue(new Error('push down'));

    const { body, status } = await runWatchdog();

    expect(status).toBe(200);
    expect(body.failed).toEqual(['T-1']);
  });
});
