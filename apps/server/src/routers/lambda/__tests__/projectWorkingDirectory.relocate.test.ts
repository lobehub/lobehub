// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanUseTopicTargets: vi.fn(),
  relocate: vi.fn(),
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
    return { relocate: mocks.relocate };
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
const input = {
  deviceId: 'device-b',
  id: '00000000-0000-4000-8000-000000000002',
  path: '/work/repo-b',
  projectId: 'project-1',
};

describe('projectWorkingDirectory.relocate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.relocate.mockResolvedValue({ id: 'directory-2' });
  });

  it('relocates once the new path exists on the chosen device', async () => {
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: true });

    await expect(caller().relocate(input)).resolves.toMatchObject({ success: true });

    expect(mocks.statPath).toHaveBeenCalledWith({
      deviceId: 'device-b',
      path: '/work/repo-b',
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(mocks.relocate).toHaveBeenCalledWith(input);
  });

  it('keeps the directory where it is when the new path is not on the device', async () => {
    mocks.statPath.mockResolvedValue({ exists: false, isDirectory: false });

    await expect(caller().relocate(input)).rejects.toThrow(
      'Device is offline or working directory is unavailable',
    );
    expect(mocks.relocate).not.toHaveBeenCalled();
  });
});
