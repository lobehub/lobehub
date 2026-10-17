// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanUseTopicTargets: vi.fn(),
  moveTopic: vi.fn(),
  resolve: vi.fn(),
  statPath: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/database/models/projectWorkingDirectory', () => ({
  ProjectWorkingDirectoryModel: vi.fn(function () {
    return { resolve: mocks.resolve };
  }),
}));

vi.mock('@/database/repositories/projectDirectory', () => ({
  ProjectDirectoryRepository: vi.fn(function () {
    return { moveTopic: mocks.moveTopic };
  }),
}));

vi.mock('../_helpers/shareVisitorTargetGuard', () => ({
  assertCreatorTopicTargets: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { statPath: mocks.statPath },
}));

vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: vi.fn(),
  assertCanUseTopicTargets: mocks.assertCanUseTopicTargets,
  assertCanViewTopicTargets: vi.fn(),
}));

const { projectWorkingDirectoryRouter } = await import('../projectWorkingDirectory');

const caller = () =>
  projectWorkingDirectoryRouter.createCaller({ userId: 'user-1', workspaceId: null } as never);
const input = { directoryId: '00000000-0000-4000-8000-000000000002', topicId: 'topic-1' };

describe('projectWorkingDirectory.moveTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ deviceId: 'device-b', path: '/work/repo-b' });
    mocks.moveTopic.mockResolvedValue({ id: 'topic-1' });
  });

  it('moves the topic once the destination directory is reachable on its device', async () => {
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: true });

    await expect(caller().moveTopic(input)).resolves.toMatchObject({ success: true });

    expect(mocks.statPath).toHaveBeenCalledWith({
      deviceId: 'device-b',
      path: '/work/repo-b',
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(mocks.moveTopic).toHaveBeenCalledWith('topic-1', input.directoryId);
  });

  it('keeps the existing binding when the destination is unavailable', async () => {
    // The device is online but the directory was removed: moving anyway would
    // drop the session that only holds on the old machine.
    mocks.statPath.mockResolvedValue({ exists: false, isDirectory: false });

    await expect(caller().moveTopic(input)).rejects.toThrow(
      'Device is offline or working directory is unavailable',
    );
    expect(mocks.moveTopic).not.toHaveBeenCalled();
  });
});
