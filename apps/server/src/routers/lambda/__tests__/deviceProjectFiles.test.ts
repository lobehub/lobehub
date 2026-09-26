// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  copyProjectFiles: vi.fn(),
  createProjectDirectory: vi.fn(),
  createProjectFile: vi.fn(),
  findByDeviceId: vi.fn(),
  moveProjectFiles: vi.fn(),
  renameProjectFile: vi.fn(),
  trashProjectFiles: vi.fn(),
  writeProjectFile: vi.fn(),
}));

// The OSS role guard is a no-op stub; stand in for the cloud one so the test
// can see which routes are write-gated. Like the real guard it only bites when
// the request carries a workspace role below `member`.
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { trpc } = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    ...actual,
    requireWorkspaceRoleWhenScoped: () =>
      trpc.middleware(async (opts: any) => {
        if (opts.ctx.workspaceRole === 'viewer') throw new TRPCError({ code: 'FORBIDDEN' });
        return opts.next();
      }),
  };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findByDeviceId = mocks.findByDeviceId;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    copyProjectFiles: mocks.copyProjectFiles,
    createProjectDirectory: mocks.createProjectDirectory,
    createProjectFile: mocks.createProjectFile,
    moveProjectFiles: mocks.moveProjectFiles,
    renameProjectFile: mocks.renameProjectFile,
    trashProjectFiles: mocks.trashProjectFiles,
    writeProjectFile: mocks.writeProjectFile,
  },
}));

const caller = () => deviceRouter.createCaller({ userId: 'user-1' } as never);

const base = { deviceId: 'dev-1', workingDirectory: '/Users/me/proj' };

const routes = [
  ['createProjectFile', { ...base, path: '/Users/me/proj/new.ts' }],
  ['createProjectDirectory', { ...base, path: '/Users/me/proj/new-dir' }],
  ['copyProjectFiles', { ...base, items: [{ sourcePath: '/Users/me/proj/a.ts' }] }],
  ['trashProjectFiles', { ...base, paths: ['/Users/me/proj/a.ts'] }],
] as const;

describe('device project file mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/Users/me/proj' }] });
    for (const [route] of routes) mocks[route].mockResolvedValue({ success: true });
  });

  it.each(routes)(
    '%s forwards to the gateway inside an approved workspace',
    async (route, input) => {
      await expect((caller()[route] as any)(input)).resolves.toEqual({ success: true });

      const { workingDirectory, deviceId, ...rest } = input;
      expect(mocks[route]).toHaveBeenCalledWith({
        ...rest,
        deviceId,
        userId: 'user-1',
        workingDirectory,
        workspaceId: undefined,
      });
    },
  );

  it.each(routes)('%s rejects a workspace root the device never approved', async (route, input) => {
    await expect(
      (caller()[route] as any)({ ...input, workingDirectory: '/' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks[route]).not.toHaveBeenCalled();
  });

  it('rejects an empty trash batch before reaching the device', async () => {
    await expect(caller().trashProjectFiles({ ...base, paths: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.trashProjectFiles).not.toHaveBeenCalled();
  });

  const writeRoutes = [
    ...routes,
    [
      'moveProjectFiles',
      { ...base, items: [{ newPath: '/Users/me/proj/b.ts', oldPath: '/Users/me/proj/a.ts' }] },
    ],
    ['renameProjectFile', { ...base, newName: 'b.ts', path: '/Users/me/proj/a.ts' }],
    ['writeProjectFile', { ...base, content: 'x', path: '/Users/me/proj/a.ts' }],
  ] as const;

  it.each(writeRoutes)('%s refuses a read-only workspace viewer', async (route, input) => {
    const viewer = deviceRouter.createCaller({
      userId: 'user-1',
      workspaceRole: 'viewer',
    } as never);
    await expect((viewer[route] as any)(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks[route]).not.toHaveBeenCalled();
  });
});
