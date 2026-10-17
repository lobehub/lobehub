import { describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from './task';

// Device-inheritance scenario tests for the runTask / runTasks dispatch
// (source-layout §2: `Foo.<scenario>.test.ts`). Split out of task.test.ts so
// the legacy test file — already over the 800-line limit — does not grow
// (AGENTS.md Code Style). Vitest hoists `vi.mock` per file, so this file
// carries its own copy of the mocks task.ts's transitive deps need.

const memberMocks = vi.hoisted(() => ({
  findLinksByUserIds: vi.fn(),
  getDisplayInfoByIds: vi.fn(),
  getEmailsByIds: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  searchAssignableMembers: vi.fn(),
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: { findByUserIds: memberMocks.findLinksByUserIds },
}));

vi.mock('@/business/server/task/notifyTaskAssigned', () => ({
  notifyTaskAssigned: memberMocks.notifyTaskAssigned,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    getDisplayInfoByIds: memberMocks.getDisplayInfoByIds,
    getEmailsByIds: memberMocks.getEmailsByIds,
  },
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn().mockImplementation(function () {
    return {
      searchAssignableMembers: memberMocks.searchAssignableMembers,
    };
  }),
}));

vi.mock('@lobechat/const/rbac', () => ({
  canWorkspaceRoleBeTaskAssignee: (role?: string | null) => !!role && role !== 'viewer',
}));

vi.mock('@/server/routers/lambda/task', () => ({
  taskRouter: {
    createCaller: () => ({ update: vi.fn().mockResolvedValue({ data: { id: 'task-1' } }) }),
  },
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.lobehub.com' },
}));

vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(),
}));

vi.mock('@/server/services/verify/planGenerator', () => ({
  VerifyPlanGeneratorService: vi.fn(),
}));

describe('runTask / runTasks device inheritance', () => {
  it('inherits the dispatching run device via deviceId for a fresh topic when the runtime context carries one', async () => {
    const taskCaller = {
      run: vi.fn().mockResolvedValue({ operationId: 'op', topicId: 'tpc' }),
    };
    const runtime = createTaskRuntime({
      activeDeviceId: 'device-parent',
      agentModel: { existsById: vi.fn() } as any,
      taskCaller: taskCaller as any,
      taskModel: {} as any,
      taskService: {} as any,
    });

    await runtime.runTask({ identifier: 'T-1' });

    expect(taskCaller.run).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-parent', id: 'T-1' }),
    );
  });

  it('does not inherit the device when continuing a topic: turnSetup keeps the existing topic binding', async () => {
    const taskCaller = {
      run: vi.fn().mockResolvedValue({ operationId: 'op', topicId: 'tpc' }),
    };
    const runtime = createTaskRuntime({
      activeDeviceId: 'device-parent',
      agentModel: { existsById: vi.fn() } as any,
      taskCaller: taskCaller as any,
      taskModel: {} as any,
      taskService: {} as any,
    });

    await runtime.runTask({ continueTopicId: 'tpc_existing', identifier: 'T-1' });

    const call = taskCaller.run.mock.calls[0][0] as Record<string, unknown>;
    expect('deviceId' in call).toBe(false);
    expect(call.continueTopicId).toBe('tpc_existing');
  });

  it('omits deviceId entirely when the dispatching run has no active device', async () => {
    const taskCaller = {
      run: vi.fn().mockResolvedValue({ operationId: 'op', topicId: 'tpc' }),
    };
    const runtime = createTaskRuntime({
      agentModel: { existsById: vi.fn() } as any,
      taskCaller: taskCaller as any,
      taskModel: {} as any,
      taskService: {} as any,
    });

    await runtime.runTask({ identifier: 'T-1' });

    const call = taskCaller.run.mock.calls[0][0] as Record<string, unknown>;
    expect('deviceId' in call).toBe(false);
  });

  it('runTasks forwards the inherited deviceId to every dispatch', async () => {
    const taskCaller = {
      run: vi.fn().mockResolvedValue({ topicId: 'tpc' }),
    };
    const runtime = createTaskRuntime({
      activeDeviceId: 'device-parent',
      agentModel: { existsById: vi.fn() } as any,
      taskCaller: taskCaller as any,
      taskModel: {} as any,
      taskService: {} as any,
    });

    await runtime.runTasks({ identifiers: ['T-A', 'T-B'] });

    expect(taskCaller.run).toHaveBeenCalledTimes(2);
    expect(taskCaller.run.mock.calls.every((c) => (c[0] as any).deviceId === 'device-parent')).toBe(
      true,
    );
  });
});
