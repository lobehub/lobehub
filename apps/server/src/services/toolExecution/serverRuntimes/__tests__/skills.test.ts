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
    checkHash: vi.fn(),
    createSandboxService: vi.fn(() => sandboxService),
    fileService: {
      getFullFileUrl: vi.fn(),
    },
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    getAgentSkills: vi.fn(),
    getUserSettings: vi.fn(),
    marketService: {},
    readResource: vi.fn(),
    sandboxService,
  };
});

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(() => ({
    findAll: mocks.findAll,
    findById: mocks.findById,
    findByName: mocks.findByName,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mocks.checkHash,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserSettings: mocks.getUserSettings,
  })),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn((skills: unknown) => skills),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(() => ({
    getAgentSkills: mocks.getAgentSkills,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => mocks.fileService),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => mocks.marketService),
}));

vi.mock('@/server/services/sandbox', async () => {
  const actual = await vi.importActual('@/server/services/sandbox');

  return {
    ...(actual as Record<string, unknown>),
    createSandboxService: mocks.createSandboxService,
  };
});

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn(() => ({
    readResource: mocks.readResource,
  })),
}));

describe('skillsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'skills/user-skill.zip' });
    mocks.fileService.getFullFileUrl.mockResolvedValue('https://files.example.com/user-skill.zip');
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.findByName.mockImplementation(async (name: string) => {
      if (name === 'user-skill') {
        return {
          id: 'user-skill-id',
          name: 'user-skill',
          zipFileHash: 'zip-hash-1',
        };
      }

      return undefined;
    });
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    mocks.sandboxService.callTool.mockResolvedValue({
      result: {
        exitCode: 0,
        output: 'ok',
        stdout: 'ok',
        success: true,
      },
      success: true,
    });
  });

  it('executes scripts through the sandbox service and only attaches persisted skill zips', async () => {
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [
        { id: 'user-skill-id', name: 'user-skill' },
        { id: 'builtin-skill-id', name: 'builtin-skill' },
      ],
      command: 'python scripts/run.py',
      description: 'Run skill script',
    });

    expect(result.success).toBe(true);
    expect(mocks.findByName).toHaveBeenCalledWith('user-skill');
    expect(mocks.findByName).toHaveBeenCalledWith('builtin-skill');
    expect(mocks.checkHash).toHaveBeenCalledWith('zip-hash-1');
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        command: 'python scripts/run.py',
        description: 'Run skill script',
        skillZipUrls: {
          'user-skill': 'https://files.example.com/user-skill.zip',
        },
      }),
    );
  });
});
