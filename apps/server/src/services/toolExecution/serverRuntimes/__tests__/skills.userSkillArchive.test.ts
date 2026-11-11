import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sandboxService = {
    callTool: vi.fn(),
    capabilities: {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    },
    exportAndUploadFile: vi.fn(),
    kind: 'onlyboxes',
  };

  return {
    buildDeviceLhEnv: vi.fn(),
    checkHash: vi.fn(),
    createSandboxService: vi.fn(function () {
      return sandboxService;
    }),
    executeToolCall: vi.fn(),
    fileService: {
      getFullFileUrl: vi.fn(),
    },
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    isLhCommand: vi.fn(),
    getAgentConfigById: vi.fn(),
    getAgentSkills: vi.fn(),
    getUserSettings: vi.fn(),
    marketService: {},
    prepareSkillDirectory: vi.fn(),
    preprocessLhCommand: vi.fn(),
    readResource: vi.fn(),
    resolveContentWorkspaceId: vi.fn(),
    resolveRunWorkspaceId: vi.fn(),
    loadRuntimeSkills: vi.fn(),
    sandboxService,
  };
});

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return {
      getAgentConfigById: mocks.getAgentConfigById,
    };
  }),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(function () {
    return {
      findAll: mocks.findAll,
      findById: mocks.findById,
      findByName: mocks.findByName,
    };
  }),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return {
      checkHash: mocks.checkHash,
    };
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return {
      getUserSettings: mocks.getUserSettings,
    };
  }),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn(function (skills: unknown) {
    return skills;
  }),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(function () {
    return {
      getAgentSkills: mocks.getAgentSkills,
    };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return mocks.fileService;
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return mocks.marketService;
  }),
}));

vi.mock('@/server/services/sandbox', async () => {
  const actual = await vi.importActual('@/server/services/sandbox');

  return {
    ...(actual as Record<string, unknown>),
    createSandboxService: mocks.createSandboxService,
  };
});

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn(function () {
    return {
      readResource: mocks.readResource,
    };
  }),
}));

vi.mock('@/server/services/toolExecution/preprocessLhCommand', () => ({
  buildDeviceLhEnv: mocks.buildDeviceLhEnv,
  isLhCommand: mocks.isLhCommand,
  preprocessLhCommand: mocks.preprocessLhCommand,
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    prepareSkillDirectory: mocks.prepareSkillDirectory,
  },
}));

vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    mocks.executeToolCall(...args),
}));

vi.mock('@/server/services/userSkill', async () => {
  const actual = await vi.importActual('@/server/services/userSkill');

  return {
    ...(actual as Record<string, unknown>),
    UserSkillService: vi.fn(function () {
      return { loadRuntimeSkills: mocks.loadRuntimeSkills };
    }),
  };
});

vi.mock('../resolveWorkspaceScope', () => ({
  resolveContentWorkspaceId: mocks.resolveContentWorkspaceId,
  resolveRunWorkspaceId: mocks.resolveRunWorkspaceId,
}));

describe('skillsRuntime user skill archives', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.fileService.getFullFileUrl.mockImplementation(
      async (key: string) => `https://files.example.com/${key}`,
    );
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findByName.mockResolvedValue(undefined);
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    mocks.preprocessLhCommand.mockImplementation(async (command: string) => ({
      command,
      isLhCommand: false,
      skipSkillLookup: false,
    }));
    mocks.isLhCommand.mockReturnValue(false);
    mocks.resolveContentWorkspaceId.mockImplementation(
      async (ctx?: { workspaceId?: string }) => ctx?.workspaceId,
    );
    mocks.resolveRunWorkspaceId.mockResolvedValue(undefined);
    mocks.sandboxService.callTool.mockResolvedValue({
      result: { exitCode: 0, output: 'ok', stdout: 'ok', success: true },
      success: true,
    });
  });

  // A user skill's scripts run from its latest published version: the archive
  // goes to the sandbox like an imported skill's zip.
  it('ships the latest version of an activated user skill to the sandbox', async () => {
    mocks.loadRuntimeSkills.mockResolvedValue([
      {
        archive: { fileHash: 'plan-hash', url: 'skills/user/plan-hash.zip' },
        body: 'Run the check',
        description: 'How each unit is done',
        identifier: 'user-skills:goal-plan-x',
        name: 'user-skills:goal-plan-x',
        title: 'Plan',
      },
    ]);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [{ id: 'user-skills:goal-plan-x', name: 'user-skills:goal-plan-x' }],
      command: 'bash scripts/check.sh',
      description: 'Run the plan check',
    });

    expect(result.success).toBe(true);
    expect(mocks.loadRuntimeSkills).toHaveBeenCalledWith(['user-skills:goal-plan-x'], {
      trustedGenerated: [],
    });
    // Never looked up among imported skills.
    expect(mocks.findByName).not.toHaveBeenCalled();
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        skillZipUrls: {
          'user-skills:goal-plan-x': 'https://files.example.com/skills/user/plan-hash.zip',
        },
      }),
    );
  }, 20_000);

  it('ships nothing for a user skill this run may not load', async () => {
    mocks.loadRuntimeSkills.mockResolvedValue([]);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await runtime.execScript({
      activatedSkills: [{ id: 'user-skills:someone-else', name: 'user-skills:someone-else' }],
      command: 'bash scripts/check.sh',
      description: 'Run a check',
    });

    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'execScript',
      expect.not.objectContaining({ skillZipUrls: expect.anything() }),
    );
  }, 20_000);
});
