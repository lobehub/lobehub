import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  executeToolCall: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    mocks.executeToolCall(...args),
}));

const { localSystemRuntime } = await import('../localSystem');

const makeContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  activeDeviceId: 'device-a',
  activeDeviceScope: 'personal',
  agentFiles: {
    deviceId: 'device-a',
    instructionPaths: ['/repo/AGENTS.md'],
    knownDirs: ['/repo', '/'],
    skillNames: ['lobehub'],
  },
  operationId: 'op-1',
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
  workingDirectory: '/repo',
  ...overrides,
});

const call = (context: ToolExecutionContext, api: string, args: Record<string, unknown>) =>
  (localSystemRuntime.factory(context) as Record<string, (args: any) => Promise<any>>)[api](args);

/** The args the device received for the last call. */
const sentArgs = () => JSON.parse(mocks.executeToolCall.mock.calls.at(-1)![1].arguments);

const webScan = {
  dirs: ['/repo/packages/web/src', '/repo/packages/web', '/repo/packages'],
  durationMs: 4,
  instructions: [
    { content: 'Root rules.', path: '/repo/AGENTS.md', source: 'AGENTS.md' },
    { content: 'Use pnpm.', path: '/repo/packages/web/AGENTS.md', source: 'AGENTS.md' },
  ],
  outcome: 'found',
  skills: [
    {
      description: 'Web design',
      name: 'web-design',
      path: '/repo/packages/web/.agents/skills/web-design/SKILL.md',
      scope: 'project',
    },
    // Already in the run's pool under the same name: never shadows it.
    { description: 'Other', name: 'LobeHub', path: '/x/SKILL.md', scope: 'project' },
    { description: '', name: 'no-description', path: '/y/SKILL.md', scope: 'project' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeToolCall.mockResolvedValue({ content: 'file body', state: {}, success: true });
});

describe('localSystemRuntime — mid-run agent file discovery', () => {
  it('asks the device, in the file call itself, for a new package’s agent files', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: 'file body',
      state: { agentFileScan: webScan, lines: 1 },
      success: true,
    });

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: 'packages/web/src/app.ts',
    });

    expect(mocks.executeToolCall).toHaveBeenCalledTimes(1);
    expect(sentArgs().agentFileScan).toEqual({ knownDirs: ['/repo', '/'] });
    expect(sentArgs().cwd).toBe('/repo');
    // The raw answer is replaced by what the run has not seen yet; the agent
    // runtime renders it once the result is final.
    expect(result.content).toBe('file body');
    expect(result.state).toEqual({
      agentFileDiscovery: {
        deviceId: 'device-a',
        dirs: webScan.dirs,
        instructions: [
          { content: 'Use pnpm.', path: '/repo/packages/web/AGENTS.md', source: 'AGENTS.md' },
        ],
        skills: [
          {
            description: 'Web design',
            location: '/repo/packages/web/.agents/skills/web-design/SKILL.md',
            name: 'web-design',
          },
        ],
      },
      lines: 1,
    });
  });

  it('never scans outside the working directory', async () => {
    await call(makeContext(), LocalSystemApiName.readFile, { path: '/other/repo/a.ts' });
    await call(makeContext(), LocalSystemApiName.readFile, { path: '../other/a.ts' });

    for (const [, request] of mocks.executeToolCall.mock.calls) {
      expect(JSON.parse(request.arguments)).not.toHaveProperty('agentFileScan');
    }
  });

  it('treats a child named ..cache as inside the working directory', async () => {
    await call(makeContext(), LocalSystemApiName.readFile, { path: '..cache/a.ts' });
    expect(sentArgs().agentFileScan).toBeDefined();
  });

  it('never offers a project skill the agent has disabled', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: 'file body',
      state: { agentFileScan: webScan },
      success: true,
    });
    const context = makeContext();
    context.agentFiles!.disabledSkillIds = ['project:web-design'];

    const result = await call(context, LocalSystemApiName.readFile, {
      path: 'packages/web/src/app.ts',
    });

    expect(result.state.agentFileDiscovery.skills).toEqual([]);
  });

  it('leaves a ~ path to the device, which resolves it like the file tool', async () => {
    await call(makeContext({ workingDirectory: '/home/u' }), LocalSystemApiName.editFile, {
      file_path: '~/pkg/a.ts',
    });

    expect(sentArgs().agentFileScan).toEqual({ knownDirs: ['/repo', '/'] });
    expect(sentArgs().cwd).toBe('/home/u');
  });

  it('scans below a Windows drive root used as the working directory', async () => {
    await call(
      makeContext({
        agentFiles: {
          deviceId: 'device-a',
          instructionPaths: [],
          knownDirs: ['C:\\'],
          skillNames: [],
        },
        workingDirectory: 'C:\\',
      }),
      LocalSystemApiName.readFile,
      { path: 'C:\\work\\pkg\\a.ts' },
    );
    expect(sentArgs().agentFileScan).toEqual({ knownDirs: ['C:\\'] });

    await call(
      makeContext({
        agentFiles: {
          deviceId: 'device-a',
          instructionPaths: [],
          knownDirs: ['C:\\'],
          skillNames: [],
        },
        workingDirectory: 'C:\\',
      }),
      LocalSystemApiName.readFile,
      { path: 'C:\\a.ts' },
    );
    expect(sentArgs()).not.toHaveProperty('agentFileScan');
  });

  it('skips a directory the run already walked, and non-file tools', async () => {
    await call(makeContext(), LocalSystemApiName.readFile, { path: '/repo/README.md' });
    expect(sentArgs()).not.toHaveProperty('agentFileScan');

    await call(makeContext(), LocalSystemApiName.grepContent, { pattern: 'x', scope: 'packages' });
    expect(sentArgs()).not.toHaveProperty('agentFileScan');
  });

  it('drops a model-supplied scan request', async () => {
    await call(makeContext(), LocalSystemApiName.runCommand, {
      agentFileScan: { knownDirs: [], root: '/' },
      command: 'ls',
    });

    expect(sentArgs()).not.toHaveProperty('agentFileScan');
  });

  it('returns the result untouched when an older client ignores the request', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: 'file body',
      state: { lines: 1 },
      success: true,
    });

    const result = await call(makeContext(), LocalSystemApiName.writeFile, {
      content: 'x',
      path: 'packages/web/a.ts',
    });

    expect(sentArgs().agentFileScan).toBeDefined();
    expect(result).toEqual({ content: 'file body', state: { lines: 1 }, success: true });
  });

  it('records walked directories even when they hold nothing new', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: 'file body',
      state: {
        agentFileScan: { dirs: ['/repo/docs'], instructions: [], outcome: 'empty', skills: [] },
      },
      success: true,
    });

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/repo/docs/a.md',
    });

    expect(result.state).toEqual({
      agentFileDiscovery: {
        deviceId: 'device-a',
        dirs: ['/repo/docs'],
        instructions: [],
        skills: [],
      },
    });
  });

  it('drops a timed-out scan so the directory is tried again', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: 'file body',
      state: { agentFileScan: { dirs: [], instructions: [], outcome: 'timed-out', skills: [] } },
      success: true,
    });

    const result = await call(makeContext(), LocalSystemApiName.readFile, {
      path: '/repo/docs/a.md',
    });

    expect(result.state).toEqual({});
  });
});
