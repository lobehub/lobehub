// @vitest-environment node
import type { WorkingDirEntry } from '@lobechat/types';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { registryRouter } from '@/server/routers/lambda/device/registry';
import { workspaceDeviceWorkingDirProcedures } from '@/server/routers/lambda/deviceWorkspaceWorkingDirs';

import { deviceService } from '../device';

const database = vi.hoisted(() => ({
  personalDirs: [] as WorkingDirEntry[],
  workspaceDirs: [] as WorkingDirEntry[],
}));

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth: async () => ({}) }));
vi.mock('@/business/client/trpc-headers', () => ({
  getBusinessTrpcHeaders: async () => ({ 'X-Workspace-Id': 'workspace' }),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findByDeviceId = async () => ({ workingDirs: database.personalDirs });
    findWorkspaceDeviceById = async (deviceId: string) =>
      deviceId === 'workspace-device' ? { userId: 'member', visibility: 'public' } : undefined;
    update = async (_deviceId: string, value: { workingDirs?: WorkingDirEntry[] }) => {
      if (value.workingDirs) database.personalDirs = value.workingDirs;
    };
    mutateWorkspaceDeviceWorkingDirs = async (
      _deviceId: string,
      apply: (dirs: WorkingDirEntry[]) => WorkingDirEntry[],
    ) => {
      database.workspaceDirs = apply(database.workspaceDirs);
    };
  },
}));

// Exercise the real client headers, authorization middleware and write handlers.
// Only the database and device-list read are fixtures; no gateway is needed.
const testRouter = router({
  device: router({
    addWorkspaceDeviceWorkingDir: workspaceDeviceWorkingDirProcedures.addWorkspaceDeviceWorkingDir,
    listDevices: authedProcedure.query(() => [
      { deviceId: 'personal-device', workingDirs: database.personalDirs },
      { deviceId: 'workspace-device', workingDirs: database.workspaceDirs },
    ]),
    updateDevice: registryRouter._def.procedures.updateDevice,
  }),
});

describe('device working-directory persistence while a workspace is active', () => {
  beforeEach(() => {
    database.personalDirs = [{ path: '/existing' }];
    database.workspaceDirs = [{ path: '/shared' }];
    vi.stubGlobal('location', new URL('http://localhost/'));
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(new URL(String(input), 'http://localhost'), init);
      return fetchRequestHandler({
        createContext: () =>
          ({
            userId: 'member',
            workspaceId: req.headers.get('X-Workspace-Id') ?? undefined,
            workspaceRole: 'member',
          }) as never,
        endpoint: '/trpc/lambda',
        req,
        router: testRouter,
      });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps an added personal directory when the device list is fetched again', async () => {
    await deviceService.updateDevice({
      deviceId: 'personal-device',
      workingDirs: [{ path: '/new' }, ...database.personalDirs],
    });

    const devices = await deviceService.listDevices();
    expect(devices[0].workingDirs).toEqual([{ path: '/new' }, { path: '/existing' }]);
    expect(devices[1].workingDirs).toEqual([{ path: '/shared' }]);
  });

  it('keeps a removed personal directory out of subsequent device lists', async () => {
    await deviceService.updateDevice({ deviceId: 'personal-device', workingDirs: [] });

    expect((await deviceService.listDevices())[0].workingDirs).toEqual([]);
  });

  it('continues saving workspace directories through the workspace scope', async () => {
    await deviceService.addWorkspaceDeviceWorkingDir({
      deviceId: 'workspace-device',
      entry: { path: '/new-shared' },
    });

    const devices = await deviceService.listDevices();
    expect(devices[1].workingDirs).toEqual([{ path: '/new-shared' }, { path: '/shared' }]);
    expect(devices[0].workingDirs).toEqual([{ path: '/existing' }]);
  });
});
