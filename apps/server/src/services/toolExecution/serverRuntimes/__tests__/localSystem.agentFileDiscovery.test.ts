import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  authorizationFailure: vi.fn(),
  awaitManagedDevice: vi.fn(),
  discoverAgentFiles: vi.fn(),
  executeToolCall: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: mocks.authorizationFailure,
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  awaitManagedDeviceForToolCall: mocks.awaitManagedDevice,
}));

vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    mocks.executeToolCall(...args),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { discoverAgentFiles: mocks.discoverAgentFiles },
}));

const { localSystemRuntime } = await import('../localSystem');

let operationSeq = 0;
const makeContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  activeDeviceId: 'device-a',
  activeDeviceScope: 'personal',
  agentFiles: {
    deviceId: 'device-a',
    instructionPaths: [],
    knownDirs: ['/home/u'],
    skillNames: ['lobehub'],
  },
  operationId: `op-${(operationSeq += 1)}`,
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
  workingDirectory: '/home/u',
  ...overrides,
});

const call = (context: ToolExecutionContext, api: string, args: Record<string, unknown>) =>
  (localSystemRuntime.factory(context) as Record<string, (args: any) => Promise<any>>)[api](args);

const adminDiscovery = {
  dirs: ['/home/u/repos/admin/src', '/home/u/repos/admin'],
  instructions: [
    { content: 'Use pnpm.', path: '/home/u/repos/admin/AGENTS.md', source: 'AGENTS.md' },
  ],
  skills: [
    {
      description: 'Admin CLI',
      name: 'admin-cli',
      path: '/home/u/repos/admin/.agents/skills/admin-cli/SKILL.md',
      scope: 'project',
    },
    // Already in the run's pool under the same name: never shadows it.
    { description: 'Other', name: 'LobeHub', path: '/x/SKILL.md', scope: 'project' },
    { description: '', name: 'no-description', path: '/y/SKILL.md', scope: 'project' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizationFailure.mockResolvedValue(undefined);
  mocks.executeToolCall.mockResolvedValue({
    content: 'file body',
    state: { lines: 1 },
    success: true,
  });
});

describe('localSystemRuntime — mid-run agent file discovery', () => {
  it('shows a new repository’s AGENTS.md and skills ahead of the file it read', async () => {
    mocks.discoverAgentFiles.mockResolvedValue(adminDiscovery);

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/repos/admin/src/index.ts',
    });

    expect(mocks.discoverAgentFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-a',
        knownDirs: ['/home/u'],
        path: '/home/u/repos/admin/src/index.ts',
      }),
    );
    expect(result.content).toMatch(/^<agent_files_discovered>/);
    expect(result.content).toContain(
      '<project_instructions source="AGENTS.md" path="/home/u/repos/admin/AGENTS.md">\nUse pnpm.',
    );
    expect(result.content).toContain('- admin-cli: Admin CLI');
    expect(result.content).not.toContain('LobeHub');
    expect(result.content).not.toContain('no-description');
    expect(result.content.endsWith('file body')).toBe(true);
    expect(result.state).toEqual({
      agentFileDiscovery: {
        deviceId: 'device-a',
        dirs: adminDiscovery.dirs,
        instructionPaths: ['/home/u/repos/admin/AGENTS.md'],
        skills: [
          {
            description: 'Admin CLI',
            location: '/home/u/repos/admin/.agents/skills/admin-cli/SKILL.md',
            name: 'admin-cli',
          },
        ],
      },
      lines: 1,
    });
  });

  it('resolves a relative path against the working directory', async () => {
    mocks.discoverAgentFiles.mockResolvedValue(undefined);

    await call(makeContext(), LocalSystemApiName.editFile, {
      file_path: 'repos/admin/a.ts',
      new_string: 'b',
      old_string: 'a',
    });

    expect(mocks.discoverAgentFiles).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/u/repos/admin/a.ts' }),
    );
  });

  it('skips the device round-trip for a directory the run already walked', async () => {
    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/notes.md',
    });

    expect(mocks.discoverAgentFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ content: 'file body', state: { lines: 1 }, success: true });
  });

  it('does not discover for searches and commands', async () => {
    await call(makeContext(), LocalSystemApiName.grepContent, {
      pattern: 'x',
      scope: '/home/u/repos/admin',
    });
    await call(makeContext(), LocalSystemApiName.runCommand, { command: 'cd /home/u/repos/admin' });

    expect(mocks.discoverAgentFiles).not.toHaveBeenCalled();
  });

  it('records the directories even when they hold nothing new', async () => {
    mocks.discoverAgentFiles.mockResolvedValue({
      dirs: ['/home/u/tmp'],
      instructions: [],
      skills: [],
    });

    const result = await call(makeContext(), LocalSystemApiName.writeFile, {
      content: 'x',
      path: '/home/u/tmp/out.txt',
    });

    expect(result.content).toBe('file body');
    expect(result.state.agentFileDiscovery).toMatchObject({ dirs: ['/home/u/tmp'] });
  });

  it('shows an instruction file once across the calls of one batch', async () => {
    mocks.discoverAgentFiles.mockResolvedValue(adminDiscovery);
    const context = makeContext();

    const [first, second] = await Promise.all([
      call(context, LocalSystemApiName.readFile, { path: '/home/u/repos/admin/src/a.ts' }),
      call(context, LocalSystemApiName.readFile, { path: '/home/u/repos/admin/src/b.ts' }),
    ]);

    const shown = [first, second].filter((result) => result.content.includes('Use pnpm.'));
    expect(shown).toHaveLength(1);
  });

  it('leaves a failed tool result untouched', async () => {
    mocks.discoverAgentFiles.mockResolvedValue(adminDiscovery);
    mocks.executeToolCall.mockResolvedValue({ content: 'ENOENT', error: 'ENOENT', success: false });

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/repos/admin/missing.ts',
    });

    expect(result.content).toBe('ENOENT');
    expect(result.state).toBeUndefined();
  });

  it('sends the tool result as is when the device cannot discover', async () => {
    mocks.discoverAgentFiles.mockRejectedValue(new Error('Unknown device RPC method'));

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/repos/admin/src/index.ts',
    });

    expect(result).toEqual({ content: 'file body', state: { lines: 1 }, success: true });
  });
  it('does not read a workspace device unshared since the run started', async () => {
    mocks.authorizationFailure.mockResolvedValue({ reason: 'unshared' });
    mocks.discoverAgentFiles.mockResolvedValue(adminDiscovery);

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/repos/admin/src/index.ts',
    });

    expect(mocks.discoverAgentFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ content: 'file body', state: { lines: 1 }, success: true });
  });

  it('keeps the nearest instruction file whole when a root file is long', async () => {
    mocks.discoverAgentFiles.mockResolvedValue({
      dirs: ['/home/u/repos/admin/pkg', '/home/u/repos/admin'],
      instructions: [
        { content: 'r'.repeat(40_000), path: '/home/u/repos/admin/AGENTS.md', source: 'AGENTS.md' },
        {
          content: 'Use the pkg CLI.',
          path: '/home/u/repos/admin/pkg/AGENTS.md',
          source: 'AGENTS.md',
        },
      ],
      skills: [],
    });

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/repos/admin/pkg/index.ts',
    });

    expect(result.content).toContain('Use the pkg CLI.');
    expect(result.content).toContain('Read /home/u/repos/admin/AGENTS.md for the rest.');
    // Root file still reads first, the order the instructions apply in.
    expect(result.content.indexOf('repos/admin/AGENTS.md')).toBeLessThan(
      result.content.indexOf('pkg/AGENTS.md'),
    );
  });

  it('asks again once a sleeping managed device comes online', async () => {
    mocks.discoverAgentFiles
      .mockRejectedValueOnce(new Error('device offline'))
      .mockResolvedValueOnce(adminDiscovery);
    mocks.executeToolCall
      .mockResolvedValueOnce({ content: 'offline', error: 'DEVICE_NOT_FOUND', success: false })
      .mockResolvedValueOnce({ content: 'file body', success: true });
    mocks.awaitManagedDevice.mockResolvedValue('online');

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/home/u/repos/admin/src/index.ts',
    });

    expect(mocks.discoverAgentFiles).toHaveBeenCalledTimes(2);
    expect(result.content).toContain('Use pnpm.');
  });
});
