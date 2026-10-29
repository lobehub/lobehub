// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  copyProjectFiles: vi.fn(),
  createProjectDirectory: vi.fn(),
  createProjectFile: vi.fn(),
  findByDeviceId: vi.fn(),
  getAgentAgencyConfig: vi.fn(),
  listClaudeCodeMemory: vi.fn(),
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
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentAgencyConfig = mocks.getAgentAgencyConfig;
  },
}));
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
    listClaudeCodeMemory: mocks.listClaudeCodeMemory,
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

describe('device listClaudeCodeMemory', () => {
  const memoryDir = '/Users/me/.claude/projects/-Users-me-proj/memory';
  const memoryFile = `${memoryDir}/MEMORY.md`;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/Users/me/proj' }] });
    mocks.writeProjectFile.mockResolvedValue({ success: true });
  });

  it('refuses a project root the device never approved', async () => {
    await expect(
      caller().listClaudeCodeMemory({ deviceId: 'dev-mem-1', workingDirectory: '/' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.listClaudeCodeMemory).not.toHaveBeenCalled();
  });

  it('approves the listed memory directory so its files can be saved', async () => {
    const write = () =>
      caller().writeProjectFile({
        content: 'x',
        deviceId: 'dev-mem-2',
        path: memoryFile,
        workingDirectory: memoryDir,
      });
    await expect(write()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    mocks.listClaudeCodeMemory.mockResolvedValue({
      files: [{ isIndex: true, name: 'MEMORY', path: memoryFile, relativePath: 'MEMORY.md' }],
      memoryDir,
    });
    await caller().listClaudeCodeMemory({ ...base, deviceId: 'dev-mem-2' });

    expect(mocks.listClaudeCodeMemory).toHaveBeenCalledWith({
      deviceId: 'dev-mem-2',
      scope: '/Users/me/proj',
      userId: 'user-1',
      workspaceId: undefined,
    });
    await expect(write()).resolves.toEqual({ success: true });
  });

  it('leaves an empty memory directory unapproved', async () => {
    mocks.listClaudeCodeMemory.mockResolvedValue({ files: [], memoryDir });
    await caller().listClaudeCodeMemory({ ...base, deviceId: 'dev-mem-3' });

    await expect(
      caller().writeProjectFile({
        content: 'x',
        deviceId: 'dev-mem-3',
        path: memoryFile,
        workingDirectory: memoryDir,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('revokes the memory directory once its project is no longer approved', async () => {
    mocks.listClaudeCodeMemory.mockResolvedValue({
      files: [{ isIndex: true, name: 'MEMORY', path: memoryFile, relativePath: 'MEMORY.md' }],
      memoryDir,
    });
    await caller().listClaudeCodeMemory({ ...base, deviceId: 'dev-mem-5' });
    const write = () =>
      caller().writeProjectFile({
        content: 'x',
        deviceId: 'dev-mem-5',
        path: memoryFile,
        workingDirectory: memoryDir,
      });
    await expect(write()).resolves.toEqual({ success: true });

    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/Users/me/other' }] });

    await expect(write()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never approves a memory directory that contains the project', async () => {
    mocks.listClaudeCodeMemory.mockResolvedValue({
      files: [
        { isIndex: false, name: 'notes', path: '/Users/me/notes.md', relativePath: 'notes.md' },
      ],
      memoryDir: '/Users/me',
    });
    await caller().listClaudeCodeMemory({ ...base, deviceId: 'dev-mem-6' });

    await expect(
      caller().writeProjectFile({
        content: 'x',
        deviceId: 'dev-mem-6',
        path: '/Users/me/.ssh/config',
        workingDirectory: '/Users/me',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("forwards the agent's stored Claude Code config dir, not one from the request", async () => {
    mocks.getAgentAgencyConfig.mockResolvedValue({
      heterogeneousProvider: {
        env: { CLAUDE_CONFIG_DIR: '/Users/me/.claude-work', OTHER: 'x' },
        type: 'claude-code',
      },
    });
    mocks.listClaudeCodeMemory.mockResolvedValue({ files: [], memoryDir });

    await caller().listClaudeCodeMemory({
      ...base,
      agentId: 'agent-1',
      deviceId: 'dev-mem-7',
      env: { CLAUDE_CONFIG_DIR: '/' },
    } as never);

    expect(mocks.getAgentAgencyConfig).toHaveBeenCalledWith('agent-1');
    expect(mocks.listClaudeCodeMemory).toHaveBeenCalledWith({
      deviceId: 'dev-mem-7',
      env: { CLAUDE_CODE_PROJECT_DIR_NAME: undefined, CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' },
      scope: '/Users/me/proj',
      userId: 'user-1',
      workspaceId: undefined,
    });
  });

  it('returns null when the device is offline', async () => {
    mocks.listClaudeCodeMemory.mockResolvedValue(undefined);
    await expect(
      caller().listClaudeCodeMemory({ ...base, deviceId: 'dev-mem-4' }),
    ).resolves.toBeNull();
  });

  it('reports an outdated memory client as an unmet precondition', async () => {
    const message = 'Unknown device RPC method: listClaudeCodeMemory';
    mocks.listClaudeCodeMemory.mockRejectedValue(new Error(message));

    await expect(caller().listClaudeCodeMemory(base)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message,
    });
  });
});
