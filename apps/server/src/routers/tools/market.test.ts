// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketRouter } from './market';

const mockPreprocessLhCommand = vi.hoisted(() => vi.fn());
const mockSandboxCallTool = vi.hoisted(() => vi.fn());
const mockCreateSandboxService = vi.hoisted(() =>
  vi.fn(() => ({
    callTool: mockSandboxCallTool,
  })),
);
const mockMarketSDK = vi.hoisted(() => ({
  skills: {
    callTool: vi.fn(),
    listLiveTools: vi.fn(),
    listTools: vi.fn(),
  },
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketUserInfo: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
  telemetry: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/libs/trpc/lambda/middleware/marketSDK', () => ({
  marketSDK: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: mockMarketSDK,
      },
    }),
  ),
  requireMarketAuth: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({})),
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mockCreateSandboxService,
}));

vi.mock('@/server/services/toolExecution/preprocessLhCommand', () => ({
  preprocessLhCommand: mockPreprocessLhCommand,
}));

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('tools marketRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass workspace scope when preprocessing sandbox lh commands', async () => {
    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);
    mockPreprocessLhCommand.mockResolvedValue({
      command: 'LOBEHUB_WORKSPACE_ID=workspace-1 npx -y @lobehub/cli agent view agt_1',
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
      command: 'LOBEHUB_WORKSPACE_ID=workspace-1 npx -y @lobehub/cli agent view agt_1',
    });
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
});
