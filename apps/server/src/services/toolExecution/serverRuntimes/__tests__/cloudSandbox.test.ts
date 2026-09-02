import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // A class instance, like the real `createSandboxService` returns — a spread
  // wrapper would silently drop these prototype methods.
  class FakeSandboxService {
    callTool = vi.fn();
    exportAndUploadFile = vi.fn();
  }

  return {
    createSandboxService: vi.fn(),
    FakeSandboxService,
    MarketService: vi.fn(() => ({})),
    preprocessLhCommand: vi.fn(),
    sandboxService: new FakeSandboxService(),
  };
});

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({})),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: mocks.MarketService,
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mocks.createSandboxService,
}));

vi.mock('@/server/services/toolExecution/preprocessLhCommand', () => ({
  isLhCommand: (command: string) => command.startsWith('lh'),
  preprocessLhCommand: mocks.preprocessLhCommand,
}));

const buildContext = (overrides: Record<string, unknown> = {}) =>
  ({
    serverDB: {} as never,
    toolManifestMap: {},
    topicId: 'topic-1',
    userId: 'user-1',
    ...overrides,
  }) as never;

describe('cloudSandboxRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSandboxService.mockReturnValue(mocks.sandboxService);
    mocks.sandboxService.callTool.mockResolvedValue({
      result: { exitCode: 0, output: 'ok', stdout: 'ok', success: true },
      success: true,
    });
    mocks.preprocessLhCommand.mockImplementation(async (command: string) => ({
      command,
      isLhCommand: false,
      skipSkillLookup: false,
    }));
  });

  // The cloud-sandbox tool exposes its own `runCommand` alongside the skills
  // tool's, and nothing in either manifest tells the model they resolve `lh`
  // differently — so an `lh` command landing here used to hit a sandbox with no
  // CLI, no credentials and no workspace scope.
  it('preprocesses lh commands with the run workspace scope', async () => {
    mocks.preprocessLhCommand.mockResolvedValueOnce({
      command:
        'lh() { LOBEHUB_WORKSPACE_ID=\'ws-42\' npx -y @lobehub/cli "$@"; }\nlh agent edit agt_1 -t x',
      isLhCommand: true,
      skipSkillLookup: true,
    });

    const { cloudSandboxRuntime } = await import('../cloudSandbox');
    const runtime = await cloudSandboxRuntime.factory(buildContext({ workspaceId: 'ws-42' }));

    await runtime.runCommand({ command: 'lh agent edit agt_1 -t x', description: 'edit self' });

    expect(mocks.preprocessLhCommand).toHaveBeenCalledWith(
      'lh agent edit agt_1 -t x',
      'user-1',
      'ws-42',
    );
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'runCommand',
      expect.objectContaining({
        command:
          'lh() { LOBEHUB_WORKSPACE_ID=\'ws-42\' npx -y @lobehub/cli "$@"; }\nlh agent edit agt_1 -t x',
      }),
    );
  });

  // `injectCredsToSandbox` (the `creds` runtime) threads `workspaceId` into its
  // MarketService, which routes workspace requests to an `org-<id>` sandbox
  // session on the market backend. If this runtime's MarketService omits
  // `workspaceId`, its shell calls resolve to the personal session instead —
  // a different sandbox than the one credentials were just injected into.
  it('scopes its MarketService to the request workspace', async () => {
    const { cloudSandboxRuntime } = await import('../cloudSandbox');
    await cloudSandboxRuntime.factory(buildContext({ workspaceId: 'ws-42' }));

    expect(mocks.MarketService).toHaveBeenCalledWith(
      expect.objectContaining({
        userInfo: { userId: 'user-1', workspaceId: 'ws-42' },
      }),
    );
  });

  it('leaves non-shell tools untouched', async () => {
    const { cloudSandboxRuntime } = await import('../cloudSandbox');
    const runtime = await cloudSandboxRuntime.factory(buildContext());

    await runtime.executeCode({ code: 'print(1)', language: 'python' });

    expect(mocks.preprocessLhCommand).not.toHaveBeenCalled();
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith('executeCode', {
      code: 'print(1)',
      language: 'python',
    });
  });

  it('surfaces a preprocessing auth failure instead of running the raw command', async () => {
    mocks.preprocessLhCommand.mockResolvedValueOnce({
      command: 'lh agent list',
      error: 'Failed to authenticate for CLI execution',
      isLhCommand: true,
      skipSkillLookup: true,
    });

    const { cloudSandboxRuntime } = await import('../cloudSandbox');
    const runtime = await cloudSandboxRuntime.factory(buildContext({ workspaceId: 'ws-42' }));

    const result = await runtime.runCommand({ command: 'lh agent list', description: 'list' });

    expect(mocks.sandboxService.callTool).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({ success: false });
  });

  it('keeps delegating exportAndUploadFile through the wrapper', async () => {
    mocks.sandboxService.exportAndUploadFile.mockResolvedValue({
      filename: 'result.csv',
      success: true,
      url: 'https://files.example.com/result.csv',
    });

    const { cloudSandboxRuntime } = await import('../cloudSandbox');
    const runtime = await cloudSandboxRuntime.factory(buildContext());

    await runtime.exportFile({ path: './out/result.csv' });

    expect(mocks.sandboxService.exportAndUploadFile).toHaveBeenCalledWith(
      './out/result.csv',
      'result.csv',
      undefined,
    );
  });
});
