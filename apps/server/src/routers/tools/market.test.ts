// @vitest-environment node
import { MarketAPIError } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MarketServiceModule from '@/server/services/market';

import { marketRouter } from './market';

const mockPreprocessLhCommand = vi.hoisted(() => vi.fn());
const mockSandboxCallTool = vi.hoisted(() => vi.fn());
const mockSandboxExportAndUploadFile = vi.hoisted(() => vi.fn());
const mockCreateSandboxService = vi.hoisted(() =>
  vi.fn(function () {
    return {
      callTool: mockSandboxCallTool,
      exportAndUploadFile: mockSandboxExportAndUploadFile,
    };
  }),
);
// Records what each MarketService was built with, so a test can see whether
// the storage claim rode on the token a sandbox call is signed with.
const mockMarketServiceOptions = vi.hoisted(() => [] as unknown[]);
const mockResolveSandboxSessionConfig = vi.hoisted(() =>
  vi.fn(async () => ({ claim: null, mode: 'ephemeral' as const })),
);
const mockMarketSDK = vi.hoisted(() => ({
  skills: {
    callTool: vi.fn(),
    listLiveTools: vi.fn(),
    listTools: vi.fn(),
  },
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketUserInfo: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
  serverDatabase: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
  telemetry: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/libs/trpc/lambda/middleware/marketSDK', () => ({
  marketSDK: vi.fn(function (opts: any) {
    return opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: mockMarketSDK,
      },
    });
  }),
  requireMarketAuth: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/market', async (importOriginal) => {
  const actual = await importOriginal<typeof MarketServiceModule>();
  return {
    ...actual,
    MarketService: vi.fn(function (options: unknown) {
      mockMarketServiceOptions.push(options);
      return new actual.MarketService(options as never);
    }),
  };
});

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mockCreateSandboxService,
  resolveSandboxSessionConfig: mockResolveSandboxSessionConfig,
}));

vi.mock('@/server/services/toolExecution/preprocessLhCommand', () => ({
  preprocessLhCommand: mockPreprocessLhCommand,
}));

vi.mock('debug', () => ({
  default: vi.fn(function () {
    return vi.fn();
  }),
}));

describe('tools marketRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarketServiceOptions.length = 0;
  });

  it('should pass workspace scope when preprocessing sandbox lh commands', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);
    mockPreprocessLhCommand.mockResolvedValue({
      command:
        'lh() { LOBEHUB_WORKSPACE_ID=\'workspace-1\' npx -y @lobehub/cli "$@"; }\nlh agent view agt_1',
      isLhCommand: true,
      skipSkillLookup: true,
    });
    mockSandboxCallTool.mockResolvedValue({ result: { ok: true }, success: true });

    await caller.execInSandbox({
      params: { command: 'lh agent view agt_1' },
      toolName: 'runCommand',
      topicId: 'topic-1',
    });

    expect(mockPreprocessLhCommand).toHaveBeenCalledWith(
      'lh agent view agt_1',
      'user-1',
      'workspace-1',
    );
    expect(mockSandboxCallTool).toHaveBeenCalledWith('runCommand', {
      command:
        'lh() { LOBEHUB_WORKSPACE_ID=\'workspace-1\' npx -y @lobehub/cli "$@"; }\nlh agent view agt_1',
    });
  });

  // Regression: this route opened the sandbox session with no mode, no
  // directory and no claim, so a conversation whose topic had chosen a
  // persistent instance still ran in the disposable `/workspace` — the
  // composer said one thing and `pwd` another. The client-side executor
  // reaches the sandbox through here, so the feature was absent for every run
  // that is not dispatched server-side.
  it('opens the session with the persistence the topic resolved', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'caller-user',
      workspaceId: 'ws-1',
    } as any);
    mockResolveSandboxSessionConfig.mockResolvedValueOnce({
      claim: { key: 'ws-org-ws-1', quotaBytes: 1024 },
      cwd: 'lobehub-dev',
      environment: 'env-1',
      mode: 'persistent',
    } as never);
    mockSandboxCallTool.mockResolvedValue({ result: { ok: true }, success: true });

    await caller.execInSandbox({
      params: { command: 'pwd' },
      toolName: 'runCommand',
      topicId: 'topic-1',
    });

    expect(mockResolveSandboxSessionConfig).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'topic-1', userId: 'caller-user', workspaceId: 'ws-1' }),
    );
    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxCwd: 'lobehub-dev',
        sandboxInstanceId: 'env-1',
        sandboxMode: 'persistent',
      }),
    );
  });

  // Regression: the same route, and the same reason as above. The environment's
  // definition is what exports its variables, runs its maintenance command and
  // cuts its network — all of it inert for a conversation that reaches the
  // sandbox through here, which is every run not dispatched server-side.
  it('opens the session with the definition the instance was built from', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'caller-user',
      workspaceId: 'ws-1',
    } as any);
    const specification = {
      env: { NODE_ENV: 'production' },
      internetAccess: false,
      maintenanceCommand: 'git pull --ff-only',
    };
    mockResolveSandboxSessionConfig.mockResolvedValueOnce({
      claim: { key: 'ws-org-ws-1', quotaBytes: 1024 },
      cwd: 'lobehub-dev',
      environment: 'env-1',
      mode: 'persistent',
      specification,
    } as never);
    mockSandboxCallTool.mockResolvedValue({ result: { ok: true }, success: true });

    await caller.execInSandbox({
      params: { command: 'env' },
      toolName: 'runCommand',
      topicId: 'topic-1',
    });

    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxSpecification: specification }),
    );
  });

  // Regression (T-14039): the export route opened its session with only
  // `topicId` and `userId` — no mode, no directory, no claim — while
  // `execInSandbox` opened the topic's persistent one. The execution plane
  // routed the export to the ephemeral runtime, so a file a command wrote under
  // `/mnt/workspace/ws-user_*` was "not found" in `/workspace`, `/root` and
  // `/tmp`, whatever path the model passed, and copies made there did not help.
  it('exports from the session the conversation commands run in', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'caller-user',
      workspaceId: 'ws-1',
    } as any);
    const claim = { drive: 'personal', key: 'ws-user_caller-user', quotaBytes: 1024 };
    const specification = { env: { NODE_ENV: 'production' } };
    mockResolveSandboxSessionConfig.mockResolvedValueOnce({
      claim,
      cwd: 'reports',
      environment: 'env-1',
      mode: 'drive',
      specification,
      workingDir: '/home/user/reports',
    } as never);
    mockSandboxExportAndUploadFile.mockResolvedValue({
      fileId: 'file-1',
      filename: 'report.pdf',
      success: true,
      url: '/f/file-1',
    });

    const result = await caller.exportAndUploadFile({
      filename: 'report.pdf',
      path: '/mnt/workspace/ws-user_caller-user/reports/report.pdf',
      topicId: 'topic-1',
    });

    expect(result).toMatchObject({ fileId: 'file-1', success: true });
    expect(mockResolveSandboxSessionConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        isShareVisitorRun: false,
        topicId: 'topic-1',
        userId: 'caller-user',
        workspaceId: 'ws-1',
      }),
    );
    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxCwd: 'reports',
        sandboxInstanceId: 'env-1',
        sandboxMode: 'drive',
        sandboxSpecification: specification,
        sandboxWorkingDir: '/home/user/reports',
        topicId: 'topic-1',
        userId: 'caller-user',
      }),
    );
    // The entitlement is read off the token, so it has to be on the one the
    // export is signed with, not only on the request.
    expect(mockMarketServiceOptions).toContainEqual(
      expect.objectContaining({
        userInfo: expect.objectContaining({ sandboxStorage: claim, userId: 'caller-user' }),
      }),
    );
    expect(mockSandboxExportAndUploadFile).toHaveBeenCalledWith(
      '/mnt/workspace/ws-user_caller-user/reports/report.pdf',
      'report.pdf',
    );
  });

  // The two routes the client-side executor uses must agree on the session:
  // a call that names another placement for the same topic runs elsewhere, and
  // can tear down the live session on the way.
  it('opens the same session for an export as for a command', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'caller-user',
      workspaceId: 'ws-1',
    } as any);
    const sessionConfig = {
      claim: { key: 'ws-org-ws-1', quotaBytes: 1024 },
      cwd: 'lobehub-dev',
      environment: 'env-1',
      mode: 'persistent',
      workingDir: '/home/user/lobehub-dev',
    };
    mockResolveSandboxSessionConfig
      .mockResolvedValueOnce(sessionConfig as never)
      .mockResolvedValueOnce(sessionConfig as never);
    mockSandboxCallTool.mockResolvedValue({ result: { ok: true }, success: true });
    mockSandboxExportAndUploadFile.mockResolvedValue({ filename: 'out.csv', success: true });

    await caller.execInSandbox({
      params: { command: 'python make_csv.py' },
      toolName: 'runCommand',
      topicId: 'topic-1',
    });
    await caller.exportAndUploadFile({ filename: 'out.csv', path: 'out.csv', topicId: 'topic-1' });

    const [commandSession, exportSession] = mockCreateSandboxService.mock.calls.map(
      ([options]: any[]) => {
        const { marketService: _marketService, ...rest } = options;
        return rest;
      },
    );
    expect(exportSession).toEqual(commandSession);
  });

  it('keeps an ephemeral topic on the caller market service when no claim resolves', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'caller-user',
      workspaceId: null,
    } as any);
    mockSandboxExportAndUploadFile.mockResolvedValue({ filename: 'a.txt', success: true });

    await caller.exportAndUploadFile({ filename: 'a.txt', path: 'a.txt', topicId: 'topic-1' });

    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: 'ephemeral', topicId: 'topic-1' }),
    );
    expect(mockMarketServiceOptions).not.toContainEqual(
      expect.objectContaining({
        userInfo: expect.objectContaining({ sandboxStorage: expect.anything() }),
      }),
    );
  });

  // Regression: `input.userId` used to override `ctx.userId`, so any
  // authenticated caller could make the server mint another user's JWT into a
  // sandbox command they control (and read their skills/files).
  it('should ignore a client-supplied userId and always use the authenticated ctx.userId', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'caller-user',
      workspaceId: null,
    } as any);
    mockPreprocessLhCommand.mockResolvedValue({
      command: 'lh agent view agt_1',
      isLhCommand: true,
      skipSkillLookup: true,
    });
    mockSandboxCallTool.mockResolvedValue({ result: { ok: true }, success: true });

    await caller.execInSandbox({
      params: { command: 'lh agent view agt_1' },
      toolName: 'runCommand',
      topicId: 'topic-1',
      userId: 'someone-else',
    });

    expect(mockPreprocessLhCommand).toHaveBeenCalledWith(
      'lh agent view agt_1',
      'caller-user',
      undefined,
    );
    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'topic-1', userId: 'caller-user' }),
    );
  });

  it('should fall back to static tools when live discovery fails', async () => {
    const caller = marketRouter.createCaller({ userId: 'user-1' } as any);
    mockMarketSDK.skills.listLiveTools.mockRejectedValue(new Error('Live discovery failed'));
    mockMarketSDK.skills.listTools.mockResolvedValue({
      tools: [
        {
          description: 'Run a PostHog query',
          inputSchema: { properties: { query: { type: 'string' } }, type: 'object' },
          name: 'query',
        },
      ],
    });

    await expect(caller.connectListTools({ provider: 'posthog' })).resolves.toEqual({
      provider: 'posthog',
      tools: [
        {
          description: 'Run a PostHog query',
          inputSchema: { properties: { query: { type: 'string' } }, type: 'object' },
          name: 'query',
        },
      ],
    });

    expect(mockMarketSDK.skills.listLiveTools).toHaveBeenCalledWith('posthog');
    expect(mockMarketSDK.skills.listTools).toHaveBeenCalledWith('posthog');
  });

  it('should preserve failed tool call error payloads', async () => {
    const caller = marketRouter.createCaller({ userId: 'user-1' } as any);
    mockMarketSDK.skills.callTool.mockResolvedValue({
      data: null,
      error: { code: 'POSTHOG_QUERY_FAILED', message: 'Query failed' },
      success: false,
    });

    await expect(
      caller.connectCallTool({
        args: { query: 'select * from events' },
        provider: 'posthog',
        toolName: 'query',
      }),
    ).resolves.toEqual({
      data: null,
      error: { code: 'POSTHOG_QUERY_FAILED', message: 'Query failed' },
      success: false,
    });

    expect(mockMarketSDK.skills.callTool).toHaveBeenCalledWith('posthog', {
      args: { query: 'select * from events' },
      tool: 'query',
      topicId: undefined,
    });
  });

  // Regression: the SDK carries the machine code in `error.code` and the message is human
  // text, so matching the message always fell through to INTERNAL_SERVER_ERROR.
  it.each(['NOT_CONNECTED', 'TOKEN_EXPIRED'])(
    'should map a Market %s error to PRECONDITION_FAILED instead of UNAUTHORIZED',
    async (code) => {
      const caller = marketRouter.createCaller({ userId: 'user-1' } as any);
      mockMarketSDK.skills.callTool.mockRejectedValue(
        new MarketAPIError(401, 'Unauthorized', { error: { code, message: 'No connection' } }),
      );

      await expect(
        caller.connectCallTool({ provider: 'linear', toolName: 'createIssue' }),
      ).rejects.toMatchObject({
        cause: { data: { code } },
        code: 'PRECONDITION_FAILED',
      });
    },
  );

  it('should keep other connectCallTool failures as INTERNAL_SERVER_ERROR', async () => {
    const caller = marketRouter.createCaller({ userId: 'user-1' } as any);
    mockMarketSDK.skills.callTool.mockRejectedValueOnce(
      new MarketAPIError(500, 'Server Error', { error: { code: 'UPSTREAM_FAILED', message: 'x' } }),
    );
    await expect(
      caller.connectCallTool({ provider: 'linear', toolName: 'createIssue' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    // A message that merely mentions the code is not a connection error.
    mockMarketSDK.skills.callTool.mockRejectedValueOnce(new Error('NOT_CONNECTED'));
    await expect(
      caller.connectCallTool({ provider: 'linear', toolName: 'createIssue' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});
