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
const mockFindByIdentifier = vi.hoisted(() => vi.fn());
const mockFindByName = vi.hoisted(() => vi.fn());
const mockCheckHash = vi.hoisted(() => vi.fn());
const mockGetFullFileUrl = vi.hoisted(() => vi.fn());

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

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(() => ({
    findByIdentifier: mockFindByIdentifier,
    findByName: mockFindByName,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mockCheckHash,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({})),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(() => ({})),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ getFullFileUrl: mockGetFullFileUrl })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({})),
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

  // Regression: the Web cloud-sandbox execScript path resolves activated-skill
  // zipUrls independently from SkillServerRuntimeService. A /skill slash-
  // preloaded skill persists the identifier (which may differ from the DB
  // display name), so this path must resolve by identifier FIRST — otherwise
  // the zipUrl misses and cwd silently falls back to the working directory,
  // the exact bug this PR fixes (on the most common Web path).
  it('resolves slash-preloaded skill zipUrls by identifier first on the cloud-sandbox path', async () => {
    mockPreprocessLhCommand.mockResolvedValue({
      command: 'python scripts/plan_layouts.py',
      isLhCommand: false,
      skipSkillLookup: false,
    });
    mockFindByIdentifier.mockResolvedValue({
      id: 'marketing-skill-id',
      identifier: 'marketing-adapter',
      name: 'Multi-Size Marketing Adapter',
      zipFileHash: 'zip-hash-2',
    });
    mockCheckHash.mockResolvedValue({ isExist: true, url: 'skills/marketing.zip' });
    mockGetFullFileUrl.mockResolvedValue('https://files.example.com/marketing.zip');
    mockSandboxCallTool.mockResolvedValue({ result: { exitCode: 0, stdout: 'ok' }, success: true });

    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await caller.execInSandbox({
      params: {
        activatedSkills: [{ identifier: 'marketing-adapter', name: 'marketing-adapter' }],
        command: 'python scripts/plan_layouts.py',
        description: 'Run layout planner',
      },
      toolName: 'execScript',
      topicId: 'topic-1',
    });

    expect(mockFindByIdentifier).toHaveBeenCalledWith('marketing-adapter');
    // identifier resolved — findByName must not be tried, so a collision with
    // another skill's display name can't pick the wrong archive.
    expect(mockFindByName).not.toHaveBeenCalledWith('marketing-adapter');
    expect(mockSandboxCallTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        skillZipUrls: { 'marketing-adapter': 'https://files.example.com/marketing.zip' },
      }),
    );
  });

  it('resolves by identifier on the cloud-sandbox path even when another skill shares that identifier as its name', async () => {
    mockPreprocessLhCommand.mockResolvedValue({
      command: 'python scripts/plan_layouts.py',
      isLhCommand: false,
      skipSkillLookup: false,
    });
    // A DIFFERENT skill whose display name collides with the target identifier.
    mockFindByName.mockResolvedValue({
      id: 'colliding-skill-id',
      identifier: 'colliding-adapter',
      name: 'marketing-adapter',
      zipFileHash: 'colliding-zip-hash',
    });
    mockFindByIdentifier.mockResolvedValue({
      id: 'marketing-skill-id',
      identifier: 'marketing-adapter',
      name: 'Multi-Size Marketing Adapter',
      zipFileHash: 'zip-hash-2',
    });
    mockCheckHash.mockResolvedValue({ isExist: true, url: 'skills/marketing.zip' });
    mockGetFullFileUrl.mockResolvedValue('https://files.example.com/marketing.zip');
    mockSandboxCallTool.mockResolvedValue({ result: { exitCode: 0, stdout: 'ok' }, success: true });

    const caller = marketRouter.createCaller({
      serverDB: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await caller.execInSandbox({
      params: {
        activatedSkills: [{ identifier: 'marketing-adapter', name: 'marketing-adapter' }],
        command: 'python scripts/plan_layouts.py',
        description: 'Run layout planner',
      },
      toolName: 'execScript',
      topicId: 'topic-1',
    });

    // identifier-first: the colliding skill's archive is never touched.
    expect(mockCheckHash).toHaveBeenCalledWith('zip-hash-2');
    expect(mockCheckHash).not.toHaveBeenCalledWith('colliding-zip-hash');
    expect(mockSandboxCallTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        skillZipUrls: { 'marketing-adapter': 'https://files.example.com/marketing.zip' },
      }),
    );
  });
});
