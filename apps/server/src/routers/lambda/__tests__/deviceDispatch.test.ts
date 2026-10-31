// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  checkoutGitBranch: vi.fn(),
  claudeCodeQuota: vi.fn(),
  executeToolCall: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  getProjectFileIndex: vi.fn(),
  gitBranch: vi.fn(),
  listHeterogeneousAgentModels: vi.fn(),
  listProjectDirectory: vi.fn(),
  listProjectSkills: vi.fn(),
  revertGitFile: vi.fn(),
  searchProjectFiles: vi.fn(),
  statPath: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    checkoutGitBranch: mocks.checkoutGitBranch,
    claudeCodeQuota: mocks.claudeCodeQuota,
    executeToolCall: mocks.executeToolCall,
    getProjectFileIndex: mocks.getProjectFileIndex,
    gitBranch: mocks.gitBranch,
    listHeterogeneousAgentModels: mocks.listHeterogeneousAgentModels,
    listProjectDirectory: mocks.listProjectDirectory,
    listProjectSkills: mocks.listProjectSkills,
    revertGitFile: mocks.revertGitFile,
    searchProjectFiles: mocks.searchProjectFiles,
    statPath: mocks.statPath,
  },
}));

type Role = 'member' | 'owner' | 'viewer';

const workspaceCaller = (userId: string, workspaceRole: Role) =>
  deviceRouter.createCaller({ userId, workspaceId: 'workspace', workspaceRole } as never);

const APPROVED = '/proj';
const OUTSIDE = '/elsewhere';

const withDevice = (visibility: 'private' | 'public') =>
  mocks.findWorkspaceDeviceById.mockResolvedValue({
    defaultCwd: null,
    deviceId: 'device',
    userId: 'enroller',
    visibility,
    workingDirs: [{ path: APPROVED }],
  });

/**
 * Routes that make the device run or probe something — every one must reject a
 * read-only viewer before any RPC reaches the machine (GHSA-p995-hm6c-329j).
 */
const deviceOps: Record<string, (caller: ReturnType<typeof workspaceCaller>) => Promise<unknown>> =
  {
    checkCapability: (c) => c.checkCapability({ deviceId: 'device', platform: 'openclaw' }),
    getAgentProfile: (c) => c.getAgentProfile({ deviceId: 'device', platform: 'openclaw' }),
    getClaudeCodeQuota: (c) => c.getClaudeCodeQuota({ deviceId: 'device' }),
    listHeterogeneousAgentModels: (c) =>
      c.listHeterogeneousAgentModels({
        command: '/bin/sh',
        deviceId: 'device',
        type: 'trae',
      }),
    scanAgents: (c) => c.scanAgents({ deviceId: 'device' }),
    statPath: (c) => c.statPath({ deviceId: 'device', path: APPROVED }),
  };

const gitWrites: Record<string, (caller: ReturnType<typeof workspaceCaller>) => Promise<unknown>> =
  {
    checkoutGitBranch: (c) =>
      c.checkoutGitBranch({ branch: 'main', deviceId: 'device', path: APPROVED }),
    revertGitFile: (c) => c.revertGitFile({ deviceId: 'device', filePath: 'a.ts', path: APPROVED }),
  };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeToolCall.mockResolvedValue({ content: '{}', success: true });
  mocks.claudeCodeQuota.mockResolvedValue({});
  mocks.listHeterogeneousAgentModels.mockResolvedValue({ models: [], status: 'success' });
  mocks.statPath.mockResolvedValue({ isDirectory: true });
  mocks.getProjectFileIndex.mockResolvedValue({ entries: [] });
  mocks.listProjectDirectory.mockResolvedValue({ entries: [] });
  mocks.listProjectSkills.mockResolvedValue({ skills: [] });
  mocks.searchProjectFiles.mockResolvedValue({ entries: [] });
  mocks.gitBranch.mockResolvedValue({ branch: 'main' });
  mocks.checkoutGitBranch.mockResolvedValue({ success: true });
  mocks.revertGitFile.mockResolvedValue({ success: true });
});

describe('device-dispatching routes on a public workspace device', () => {
  it.each(Object.keys(deviceOps))('rejects %s from a read-only viewer', async (procedure) => {
    withDevice('public');
    await expect(deviceOps[procedure](workspaceCaller('viewer', 'viewer'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('Workspace viewers cannot'),
    });
  });

  it.each(Object.keys(gitWrites))(
    'rejects git mutation %s from a read-only viewer even inside an approved root',
    async (procedure) => {
      withDevice('public');
      await expect(gitWrites[procedure](workspaceCaller('viewer', 'viewer'))).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(deviceOps))('lets a member call %s', async (procedure) => {
    withDevice('public');
    await expect(deviceOps[procedure](workspaceCaller('member', 'member'))).resolves.not.toThrow();
  });

  it.each(Object.keys(gitWrites))('lets a member run git mutation %s', async (procedure) => {
    withDevice('public');
    await expect(gitWrites[procedure](workspaceCaller('member', 'member'))).resolves.not.toThrow();
    expect(mocks[procedure]).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device', userId: 'member' }),
    );
  });
});

describe('device-dispatching routes on a private workspace device', () => {
  it.each(Object.keys(deviceOps))('rejects %s on a device the caller cannot see', async (p) => {
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
    await expect(deviceOps[p](workspaceCaller('member', 'member'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each(Object.keys(deviceOps))(
    'lets the enroller call %s on their private device',
    async (p) => {
      withDevice('private');
      await expect(deviceOps[p](workspaceCaller('enroller', 'member'))).resolves.not.toThrow();
    },
  );

  it.each(Object.keys(gitWrites))(
    'rejects git mutation %s from a member without operate rights',
    async (procedure) => {
      withDevice('private');
      // Defense in depth: even if a non-enroller somehow resolved the row,
      // the operate gate (enroller or owner only on a private device) still
      // stands between them and the git RPC.
      await expect(gitWrites[procedure](workspaceCaller('member', 'member'))).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );
});

describe('device file/git reads confined to approved roots', () => {
  const reads: Record<string, (caller: ReturnType<typeof workspaceCaller>) => Promise<unknown>> = {
    getProjectFileIndex: (c) => c.getProjectFileIndex({ deviceId: 'device', scope: OUTSIDE }),
    gitBranch: (c) => c.gitBranch({ deviceId: 'device', path: OUTSIDE }),
    listProjectSkills: (c) => c.listProjectSkills({ deviceId: 'device', scope: OUTSIDE }),
    searchProjectFiles: (c) =>
      c.searchProjectFiles({ deviceId: 'device', query: 'foo', scope: OUTSIDE }),
  };

  it.each(Object.keys(reads))('rejects %s outside every approved root', async (procedure) => {
    withDevice('public');
    await expect(reads[procedure](workspaceCaller('member', 'member'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('approved workspace'),
    });
    expect(mocks[procedure]).not.toHaveBeenCalled();
  });

  it.each(Object.keys(reads))(
    'lets a read-only viewer %s inside an approved root',
    async (procedure) => {
      withDevice('public');
      const caller = workspaceCaller('viewer', 'viewer');
      const input = { deviceId: 'device' };
      const calls: Record<string, Promise<unknown>> = {
        getProjectFileIndex: caller.getProjectFileIndex({ ...input, scope: APPROVED }),
        gitBranch: caller.gitBranch({ ...input, path: APPROVED }),
        listProjectSkills: caller.listProjectSkills({ ...input, scope: APPROVED }),
        searchProjectFiles: caller.searchProjectFiles({
          ...input,
          query: 'foo',
          scope: APPROVED,
        }),
      };
      await expect(calls[procedure]).resolves.not.toThrow();
    },
  );

  it('rejects listProjectDirectory when relativePath escapes the approved root', async () => {
    withDevice('public');
    await expect(
      workspaceCaller('member', 'member').listProjectDirectory({
        deviceId: 'device',
        relativePath: '../../etc',
        root: APPROVED,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.listProjectDirectory).not.toHaveBeenCalled();
  });
});
