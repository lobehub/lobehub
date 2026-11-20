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

vi.mock('../resolveWorkspaceScope', () => ({
  resolveContentWorkspaceId: mocks.resolveContentWorkspaceId,
  resolveRunWorkspaceId: mocks.resolveRunWorkspaceId,
}));

const EXTRACTED_DIR = '/home/user/.lobehub/skills/extracted/zip-hash-1';
const WORKING_DIR = '/home/user/LobeHub/sandbox/agent-1';

const runOnDevice = async (context: {
  localSandbox?: boolean;
  localSandboxNetwork?: boolean;
  workingDirectory?: string;
}) => {
  const { skillsRuntime } = await import('../skills');
  const runtime = await skillsRuntime.factory({
    activeDeviceId: 'device-1',
    serverDB: {} as never,
    toolManifestMap: {},
    topicId: 'topic-1',
    userId: 'user-1',
    workingDirectory: WORKING_DIR,
    ...context,
  });

  return runtime.execScript({
    activatedSkills: [{ id: 'user-skill-id', name: 'user-skill' }],
    command: 'echo hi > /etc/owned',
    // A model-supplied fence switch or root must be ignored.
    ...({ cwd: '/', sandbox: false } as object),
    description: 'Write outside the skill directory',
  });
};

const dispatchedArgs = () =>
  JSON.parse(mocks.executeToolCall.mock.calls[0][1].arguments) as Record<string, unknown>;

describe('skillsRuntime execScript Local Sandbox fence (device path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'skills/user-skill.zip' });
    mocks.fileService.getFullFileUrl.mockResolvedValue('https://files.example.com/user-skill.zip');
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.getAgentConfigById.mockResolvedValue(undefined);
    mocks.findByName.mockImplementation(async (name: string) =>
      name === 'user-skill'
        ? { id: 'user-skill-id', name: 'user-skill', zipFileHash: 'zip-hash-1' }
        : undefined,
    );
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    mocks.preprocessLhCommand.mockImplementation(async (command: string) => ({
      command,
      isLhCommand: false,
      skipSkillLookup: false,
    }));
    mocks.isLhCommand.mockReturnValue(false);
    mocks.buildDeviceLhEnv.mockReturnValue(undefined);
    mocks.resolveContentWorkspaceId.mockImplementation(
      async (ctx?: { workspaceId?: string }) => ctx?.workspaceId,
    );
    mocks.resolveRunWorkspaceId.mockResolvedValue(undefined);
    mocks.prepareSkillDirectory.mockResolvedValue({ extractedDir: EXTRACTED_DIR, success: true });
    mocks.executeToolCall.mockResolvedValue({
      content: 'ok',
      state: { exitCode: 0, stdout: 'ok', success: true },
      success: true,
    });
  });

  it('runs from the extracted skill directory but fences to the working directory', async () => {
    // The extracted directory is the device's shared skill cache: fencing to it
    // would let a fenced run plant code that a later unfenced run executes.
    await runOnDevice({ localSandbox: true, localSandboxNetwork: true });

    expect(dispatchedArgs()).toEqual({
      command: 'echo hi > /etc/owned',
      cwd: EXTRACTED_DIR,
      sandbox: true,
      sandboxNetwork: true,
      sandboxRoot: WORKING_DIR,
    });
  }, 30_000);

  it('refuses a fenced run with no working directory instead of fencing the skill cache', async () => {
    const result = await runOnDevice({ localSandbox: true, workingDirectory: undefined });

    expect(result.success).toBe(false);
    expect(result.content).toContain('requires a working directory');
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
  });

  it('keeps the registry network closed unless the run allowed it', async () => {
    await runOnDevice({ localSandbox: true });

    expect(dispatchedArgs()).toMatchObject({ sandbox: true, sandboxNetwork: false });
  });

  it('reports the device sandbox refusal instead of a silent success', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: '',
      state: {
        exitCode: 1,
        stderr: 'bash: /etc/owned: Operation not permitted',
        success: false,
      },
      success: true,
    });

    const result = await runOnDevice({ localSandbox: true });

    expect(result.success).toBe(false);
    expect(result.content).toContain('Operation not permitted');
  });

  it('pins sandbox off for a local run that did not opt in', async () => {
    await runOnDevice({ localSandbox: false });

    expect(dispatchedArgs()).toEqual({
      command: 'echo hi > /etc/owned',
      cwd: EXTRACTED_DIR,
      sandbox: false,
    });
  });

  it('leaves the dispatch untouched when the run carries no sandbox decision', async () => {
    await runOnDevice({});

    expect(dispatchedArgs()).toEqual({ command: 'echo hi > /etc/owned', cwd: EXTRACTED_DIR });
  });
});
