import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentDocumentsCtor: vi.fn(),
  executeToolCall: vi.fn(),
  findAll: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  getAgentConfigById: vi.fn(),
  getAgentSkills: vi.fn(),
  getUserSettings: vi.fn(),
  listCatalog: vi.fn(),
  loadRuntimeSkills: vi.fn(),
  resolveContentWorkspaceId: vi.fn(),
  resolveRunWorkspaceId: vi.fn(),
}));

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [
    {
      content: '# Artifacts body',
      description: 'Render artifacts',
      identifier: 'artifacts',
      name: 'Artifacts',
      source: 'builtin',
    },
  ],
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
    return { checkHash: vi.fn() };
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
  AgentDocumentsService: vi.fn(function (...args: unknown[]) {
    mocks.agentDocumentsCtor(...args);
    return {
      getAgentSkills: mocks.getAgentSkills,
    };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFullFileUrl: vi.fn() };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/sandbox', async () => {
  const actual = await vi.importActual('@/server/services/sandbox');
  return {
    ...(actual as Record<string, unknown>),
    createSandboxService: vi.fn(),
    resolveSandboxSessionConfig: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn(function () {
    return { readResource: vi.fn() };
  }),
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
      return {
        listCatalog: mocks.listCatalog,
        loadRuntimeSkills: mocks.loadRuntimeSkills,
      };
    }),
  };
});

vi.mock('../resolveWorkspaceScope', () => ({
  resolveContentWorkspaceId: mocks.resolveContentWorkspaceId,
  resolveRunWorkspaceId: mocks.resolveRunWorkspaceId,
}));

describe('skillsRuntime prompt/runtime consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.findByName.mockResolvedValue(undefined);
    mocks.getAgentConfigById.mockResolvedValue({
      plugins: [
        { identifier: 'artifacts', mode: 'auto' },
        { identifier: 'db-skill-id', mode: 'auto' },
      ],
    });
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.getUserSettings.mockResolvedValue({});
    mocks.listCatalog.mockResolvedValue([]);
    mocks.loadRuntimeSkills.mockResolvedValue([]);
    mocks.resolveContentWorkspaceId.mockResolvedValue('ws-recovered');
    mocks.resolveRunWorkspaceId.mockResolvedValue(undefined);
  });

  it('uses the recovered workspaceId when loading agent-document skills', async () => {
    mocks.getAgentSkills.mockResolvedValue([
      {
        content: '# Agent skill body',
        description: 'Agent doc skill',
        identifier: 'agent-skills:guide',
        name: 'agent-skills:guide',
      },
    ]);

    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      agentId: 'agent-1',
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      // Deliberately omitted to mirror dispatch/resume paths
    });

    const result = await runtime.activateSkill({ name: 'agent-skills:guide' });

    expect(mocks.agentDocumentsCtor).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'ws-recovered',
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain('# Agent skill body');
  }, 20_000);

  it('returns project, DB, builtin, agent-document, and user-library skills on activateSkill miss', async () => {
    mocks.findAll.mockResolvedValue({
      data: [{ description: 'DB helper', id: '1', identifier: 'db-skill-id', name: 'db-helper' }],
      total: 1,
    });
    mocks.getAgentSkills.mockResolvedValue([
      {
        content: '# Agent doc',
        description: 'Agent doc',
        identifier: 'agent-skills:doc',
        name: 'agent-skills:doc',
      },
    ]);
    mocks.listCatalog.mockResolvedValue([
      {
        description: 'Saved user plan',
        generated: false,
        identifier: 'user-skills:plan',
        name: 'user-skills:plan',
        title: 'Plan',
      },
    ]);

    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      agentId: 'agent-1',
      projectSkills: [
        {
          description: 'Project deploy',
          location: '/repo/.agents/skills/deploy/SKILL.md',
          name: 'deploy',
          source: 'project',
        },
      ],
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.activateSkill({ name: 'typo-skill' });

    expect(result.success).toBe(false);
    const candidates = JSON.parse(result.content.slice(result.content.indexOf('['))) as Array<{
      description?: string;
      name: string;
    }>;
    expect(candidates).toEqual([
      { description: 'Project deploy', name: 'deploy' },
      { description: 'DB helper', name: 'db-helper' },
      { description: 'Render artifacts', name: 'Artifacts' },
      { description: 'Agent doc', name: 'agent-skills:doc' },
      { description: 'Saved user plan', name: 'user-skills:plan' },
    ]);
  }, 20_000);
});
