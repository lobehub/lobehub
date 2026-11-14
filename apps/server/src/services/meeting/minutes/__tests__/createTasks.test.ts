// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDetail = vi.fn();
const updateActionItems = vi.fn();

vi.mock('@/database/models/meeting', () => ({
  MeetingModel: vi.fn(function () {
    return { getDetail, updateActionItems };
  }),
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function () {
    return { searchAssignableMembers: vi.fn(async () => ({ rows: [] })) };
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { getDisplayInfoByIds: vi.fn(async () => []) },
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { queryAgents: vi.fn(async () => []) };
  }),
}));

vi.mock('@/database/models/notification', () => ({
  NotificationModel: vi.fn(function () {
    return { create: vi.fn(async () => undefined) };
  }),
}));

const createTask = vi.fn();

vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(function () {
    return { createTask };
  }),
}));

vi.mock('@/server/services/task/assignmentNotification', () => ({
  notifyAssignedBestEffort: vi.fn(),
}));

const { MeetingMinutesService } = await import('../index');

const item = (id: string) => ({
  id,
  segmentIds: [],
  startMs: 0,
  status: 'suggested' as const,
  text: `task ${id}`,
});

const meetingDetail = (visibility: 'private' | 'public') => ({
  actionItems: undefined,
  id: 'meeting-1',
  minutes: { actionItems: [item('a'), item('b')] },
  segments: [],
  title: 'Quarterly review',
  userId: 'user-1',
  visibility,
});

const service = () => new MeetingMinutesService({} as any, 'user-1', 'workspace-1');

beforeEach(() => {
  vi.clearAllMocks();
  createTask.mockImplementation(async (input: { name: string }) => ({
    assigneeUserId: null,
    id: `task-${input.name}`,
    identifier: 'T-1',
    name: input.name,
  }));
  updateActionItems.mockImplementation(async (_id: string, update: any) => ({
    actionItems: update([item('a'), item('b')]),
  }));
});

describe('MeetingMinutesService.createTasks', () => {
  it('creates private tasks for a private meeting so the minutes do not leak', async () => {
    getDetail.mockResolvedValue(meetingDetail('private'));

    await service().createTasks('meeting-1', [{ id: 'a', text: 'task a' }]);

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].visibility).toBe('private');
  });

  it('leaves a public meeting to the default visibility rules', async () => {
    getDetail.mockResolvedValue(meetingDetail('public'));

    await service().createTasks('meeting-1', [{ id: 'a', text: 'task a' }]);

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0]).not.toHaveProperty('visibility');
  });

  it("creates nothing from another member's public meeting", async () => {
    getDetail.mockResolvedValue({ ...meetingDetail('public'), userId: 'someone-else' });

    const result = await service().createTasks('meeting-1', [{ id: 'a', text: 'task a' }]);

    expect(result).toBeUndefined();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('creates one task when a request repeats the same item id', async () => {
    getDetail.mockResolvedValue(meetingDetail('public'));

    const result = await service().createTasks('meeting-1', [
      { id: 'a', text: 'task a' },
      { id: 'a', text: 'task a again' },
    ]);

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(result?.created).toHaveLength(1);
  });
});
