// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanUseTopicTargets: vi.fn(),
  bind: vi.fn(),
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

vi.mock('@/database/repositories/projectDirectory', () => ({
  ProjectDirectoryRepository: vi.fn(function () {
    return { bind: mocks.bind };
  }),
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
const input = {
  deviceId: 'device-m4',
  name: 'develop-center',
  path: '/Users/other/CodeProjects/develop-center',
  projectId: 'project-1',
  topicIds: ['topic-1'],
};

describe('projectWorkingDirectory.bind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bind.mockResolvedValue({ id: 'directory-1' });
  });

  it('rejects a path that does not exist on the device', async () => {
    // Legacy topic metadata paired this device with another machine's path;
    // binding it left every topic under it failing with working_directory_not_found.
    mocks.statPath.mockResolvedValue({ exists: false, isDirectory: false });

    await expect(caller().bind(input)).rejects.toThrow(
      'Working directory does not exist on this device',
    );
    expect(mocks.statPath).toHaveBeenCalledWith({
      deviceId: 'device-m4',
      path: input.path,
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it('rejects a path that is a file', async () => {
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: false });

    await expect(caller().bind(input)).rejects.toThrow(
      'Working directory does not exist on this device',
    );
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it('binds a directory that exists on the device', async () => {
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: true });

    await expect(caller().bind(input)).resolves.toEqual({
      data: { id: 'directory-1' },
      success: true,
    });
    expect(mocks.bind).toHaveBeenCalledWith(input);
  });

  it('still binds when the device cannot be reached to verify', async () => {
    mocks.statPath.mockResolvedValue(undefined);

    await expect(caller().bind(input)).resolves.toMatchObject({ success: true });
    expect(mocks.bind).toHaveBeenCalledWith(input);
  });
});
