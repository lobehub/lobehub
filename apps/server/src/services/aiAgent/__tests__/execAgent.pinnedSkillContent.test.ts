import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

// Verifies that a PINNED skill (DB `agent_skills` row or agent-document bundle)
// has its SKILL.md body eagerly injected into the operation's skill set — so
// downstream SkillResolver/SkillContextProvider inject the content directly
// instead of requiring the model to call `activateSkill`. Non-pinned (auto)
// skills stay content-less here and remain lazily activatable.
const {
  mockConnectorResolveByIdentifiers,
  mockConnectorToolQueryAll,
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockGetAgentConfig,
  mockGetAgentSkills,
  mockGetComposioManifests,
  mockGetLobehubSkillManifests,
  mockHasDocuments,
  mockMessageCreate,
  mockPluginQuery,
  mockSkillFindAll,
  mockSkillFindByIds,
} = vi.hoisted(() => ({
  mockConnectorResolveByIdentifiers: vi.fn().mockResolvedValue([]),
  mockConnectorToolQueryAll: vi.fn().mockResolvedValue([]),
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockGetAgentConfig: vi.fn(),
  mockGetAgentSkills: vi.fn().mockResolvedValue([]),
  mockGetComposioManifests: vi.fn().mockResolvedValue([]),
  mockGetLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  mockHasDocuments: vi.fn().mockResolvedValue(false),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn().mockResolvedValue([]),
  mockSkillFindAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  mockSkillFindByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({ decrypt: vi.fn(), encrypt: vi.fn() }),
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({ getAgentConfig: mockGetAgentConfig })),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn().mockImplementation(() => ({
    findAll: mockSkillFindAll,
    findByIds: mockSkillFindByIds,
  })),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(() => ({
    findRowByDocumentId: vi.fn().mockResolvedValue(undefined),
    getAgentSkills: mockGetAgentSkills,
    hasDocuments: mockHasDocuments,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({ query: mockPluginQuery })),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    resolveByIdentifiers: mockConnectorResolveByIdentifiers,
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    queryAllByConnectorIds: mockConnectorToolQueryAll,
    queryByConnector: vi.fn().mockResolvedValue([]),
    queryByConnectorIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({ createOperation: mockCreateOperation })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: mockGetLobehubSkillManifests,
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: mockGetComposioManifests,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ uploadFromUrl: vi.fn() })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      { abilities: { functionCall: true }, id: 'gpt-4', providerId: 'openai' },
    ],
  };
});

// SKILL.md bodies live in the `content` column already (frontmatter stripped),
// so `findByIds` returns them with no zip unpack. `resources` is carried by
// `skillItemColumns` too (used by the eager resource-tree injection).
const DB_SKILL_ROWS = [
  { content: 'PINNED SKILL BODY', id: 'sk-1', identifier: 'db-skill-pinned', resources: {} },
  { content: 'AUTO SKILL BODY', id: 'sk-2', identifier: 'db-skill-auto', resources: {} },
  {
    content: 'ZIP SKILL BODY',
    id: 'sk-3',
    identifier: 'db-skill-with-resources',
    resources: { 'refs/guide.md': { fileHash: 'abc', size: 10 } },
  },
];

const operationSkillSetArg = () =>
  mockCreateOperation.mock.calls[0][0].operationSkillSet as
    | {
        enabledPluginIds: string[];
        skills: Array<{ content?: string; identifier: string; name: string }>;
      }
    | undefined;

const skillById = (identifier: string) =>
  operationSkillSetArg()?.skills.find((s) => s.identifier === identifier);

describe('AiAgentService.execAgent - pinned skill content injection', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    // `findAll` uses `skillListColumns` — it never returns `content`.
    mockSkillFindAll.mockResolvedValue({
      data: DB_SKILL_ROWS.map(({ id, identifier }) => ({
        description: 'd',
        id,
        identifier,
        name: identifier,
      })),
      total: DB_SKILL_ROWS.length,
    });
    // `findByIds` uses `skillItemColumns` — it carries `content`.
    mockSkillFindByIds.mockImplementation(async (ids: string[]) =>
      DB_SKILL_ROWS.filter((r) => ids.includes(r.id)),
    );
    mockGetAgentSkills.mockResolvedValue([]);
    mockHasDocuments.mockResolvedValue(false);
    service = new AiAgentService({} as any, 'test-user-id');
  });

  it('injects a pinned DB skill body into the operation skill set, leaving auto skills content-less', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      // db-skill-pinned is pinned; db-skill-auto is absent from plugins → auto.
      plugins: ['db-skill-pinned'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(operationSkillSetArg()?.enabledPluginIds).toContain('db-skill-pinned');
    expect(skillById('db-skill-pinned')?.content).toBe('PINNED SKILL BODY');
    // The auto skill is still listed (activatable) but carries no body.
    expect(skillById('db-skill-auto')?.content).toBeUndefined();
  });

  it('fetches bodies only for the pinned subset to keep the op-param payload bounded', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['db-skill-pinned'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    // Only the pinned skill's row id is fetched — not the auto skill (sk-2).
    expect(mockSkillFindByIds).toHaveBeenCalledWith(['sk-1']);
  });

  it('injects a pinned agent-document skill body without an extra fetch', async () => {
    mockGetAgentSkills.mockResolvedValue([
      {
        content: 'AGENT DOC SKILL BODY',
        description: 'd',
        filename: 'foo.md',
        identifier: 'agent-skills:foo',
        name: 'agent-skills:foo',
        title: null,
      },
    ]);
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['agent-skills:foo'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(skillById('agent-skills:foo')?.content).toBe('AGENT DOC SKILL BODY');
    // Agent-document bodies come from `getAgentSkills`, never the DB skill fetch.
    expect(mockSkillFindByIds).toHaveBeenCalledWith([]);
  });

  it('does not attach content when no skill is pinned', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(skillById('db-skill-pinned')?.content).toBeUndefined();
    expect(skillById('db-skill-auto')?.content).toBeUndefined();
    expect(mockSkillFindByIds).toHaveBeenCalledWith([]);
  });

  it('does not eager-inject an auto skill whose identifier collides with a turn-scoped tool id', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      // Nothing pinned — db-skill-auto is in auto mode.
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    // db-skill-auto lands in the expanded operation tool list (`agentPlugins`)
    // via a turn-scoped @-mention pick, but it is NOT pinned on the agent.
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      selectedToolIds: ['db-skill-auto'],
    } as any);

    // Eager injection must gate on the pinned set, not the expanded tool list,
    // so the colliding auto skill stays content-less (lazily activatable).
    expect(skillById('db-skill-auto')?.content).toBeUndefined();
    expect(mockSkillFindByIds).toHaveBeenCalledWith([]);
  });

  it('appends the resource tree to a pinned skill body, mirroring activateSkill', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['db-skill-with-resources'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    const injected = skillById('db-skill-with-resources')?.content;
    // Body plus the readReference resource tree — so a pinned ZIP/GitHub skill
    // keeps its resource paths even though it's removed from <available_skills>.
    expect(injected).toContain('ZIP SKILL BODY');
    expect(injected).toContain('Available Resources');
    expect(injected).toContain('guide.md');
  });
});
