import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerContextFactProviders } from './index';

const {
  agentDocumentsConstructor,
  credsList,
  findById,
  getAgentContextDocuments,
  getInfoForAIGeneration,
  getUserSettings,
  loadConnectedComposioIds,
  pluginQuery,
} = vi.hoisted(() => ({
  agentDocumentsConstructor: vi.fn(),
  credsList: vi.fn(),
  findById: vi.fn(),
  getAgentContextDocuments: vi.fn(),
  getInfoForAIGeneration: vi.fn(),
  getUserSettings: vi.fn(),
  loadConnectedComposioIds: vi.fn(),
  pluginQuery: vi.fn(),
}));

const mockResolveSandboxSessionConfig = vi.hoisted(() =>
  vi.fn(async () => ({ claim: null, mode: 'ephemeral' as const })),
);

vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxSessionConfig: mockResolveSandboxSessionConfig,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(
    class {
      getUserSettings = getUserSettings;
    },
    { getInfoForAIGeneration },
  ),
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: class {
    query = pluginQuery;
  },
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    findById = findById;
  },
}));
vi.mock('@/server/modules/AgentRuntime/adapters/composioConnectedIds', () => ({
  loadConnectedComposioIds,
}));
vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: class {
    constructor(...args: unknown[]) {
      agentDocumentsConstructor(...args);
    }

    getAgentContextDocuments = getAgentContextDocuments;
    getDocumentByFilename = vi.fn();
  },
}));
const { redisIndexGet, redisIndexSet } = vi.hoisted(() => ({
  redisIndexGet: vi.fn(),
  redisIndexSet: vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: { agentDocumentIndex: { get: redisIndexGet, set: redisIndexSet } },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.test' } }));
vi.mock('@/server/services/market', () => ({
  MarketService: class {
    market = {
      creds: { list: credsList },
      organizations: { creds: () => ({ list: credsList }) },
    };
  },
}));

const source = (state: Record<string, unknown> = {}) => ({
  ctx: { serverDB: {}, userId: 'owner-1', workspaceId: 'ws-1' } as never,
  state: state as never,
});

describe('createServerContextFactProviders', () => {
  describe('listCredentials', () => {
    const frozen = {
      credentials: [{ key: 'OPENAI', name: 'OpenAI', type: 'apiKey' }],
      workspaceId: 'ws-1',
    };

    it('answers from the run snapshot without asking the Market API', async () => {
      const providers = createServerContextFactProviders(source({ operationCredentials: frozen }));

      await expect(providers.listCredentials!({ workspaceId: 'ws-1' })).resolves.toEqual(
        frozen.credentials,
      );
      expect(credsList).not.toHaveBeenCalled();
      expect(getUserSettings).not.toHaveBeenCalled();
    });

    it('reads live when the snapshot was taken in another scope', async () => {
      getUserSettings.mockResolvedValue({ market: { accessToken: 't' } });
      credsList.mockResolvedValue({ data: [{ key: 'LIVE', name: 'Live', type: 'apiKey' }] });
      const providers = createServerContextFactProviders(source({ operationCredentials: frozen }));

      await expect(providers.listCredentials!({ workspaceId: undefined })).resolves.toEqual([
        expect.objectContaining({ key: 'LIVE' }),
      ]);
      expect(credsList).toHaveBeenCalledTimes(1);
    });

    it('reads live when the run has no snapshot', async () => {
      credsList.mockResolvedValue({ data: [] });
      const providers = createServerContextFactProviders(source());

      await expect(providers.listCredentials!({ workspaceId: 'ws-1' })).resolves.toEqual([]);
      expect(credsList).toHaveBeenCalled();
    });
  });

  it('answers nothing without a database or user', () => {
    expect(createServerContextFactProviders({ ctx: {} as never, state: {} as never })).toEqual({});
  });

  it('reads user info for the user the rules name, defaulting to the run owner', async () => {
    getInfoForAIGeneration.mockResolvedValue({ responseLanguage: 'ja-JP', userName: 'v' });
    const providers = createServerContextFactProviders(source());

    await expect(providers.getUserInfo!('visitor-1')).resolves.toEqual({
      language: 'ja-JP',
      username: 'v',
    });
    expect(getInfoForAIGeneration).toHaveBeenLastCalledWith(expect.anything(), 'visitor-1');

    await providers.getUserInfo!(undefined);
    expect(getInfoForAIGeneration).toHaveBeenLastCalledWith(expect.anything(), 'owner-1');
  });

  it('unions connected Composio services with the run’s LobeHub skill providers', async () => {
    loadConnectedComposioIds.mockResolvedValue(new Set(['gmail']));
    const providers = createServerContextFactProviders(
      source({
        operationToolSet: {
          sourceMap: {
            'gmail': 'composio',
            'lobehub-skill-x': 'lobehubSkill',
            'weather': 'builtin',
          },
        },
      }),
    );

    const ids = new Set(await providers.listConnectedConnectorIds!('agt_1'));
    expect(ids).toEqual(new Set(['gmail', 'lobehub-skill-x']));
  });

  it('offers every installed custom MCP connector, pinned or not, and nothing else', async () => {
    pluginQuery.mockResolvedValue([
      {
        identifier: 'my-mcp',
        manifest: { meta: { description: 'Local files', title: 'My MCP' } },
        type: 'customPlugin',
      },
      { identifier: 'market-plugin', manifest: { meta: { title: 'Market' } }, type: 'plugin' },
    ]);

    await expect(
      createServerContextFactProviders(source({ operationToolSet: { sourceMap: {} } }))
        .listCustomPlugins!(),
    ).resolves.toEqual([
      { description: 'Local files', identifier: 'my-mcp', name: 'My MCP', type: 'custom' },
    ]);
  });

  it('reads the uninstalled builtin list from the scope the run belongs to', async () => {
    getUserSettings.mockResolvedValue({
      tool: {
        uninstalledBuiltinTools: ['lobe-personal-gone'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['lobe-ws-gone'] },
      },
    });

    await expect(
      createServerContextFactProviders(source({ origin: { workspaceId: 'ws-1' } }))
        .listUninstalledBuiltinIds!(),
    ).resolves.toEqual(['lobe-ws-gone']);
    await expect(
      createServerContextFactProviders({
        ctx: { serverDB: {}, userId: 'owner-1' } as never,
        state: {} as never,
      }).listUninstalledBuiltinIds!(),
    ).resolves.toEqual(['lobe-personal-gone']);
  });

  it('falls back to the default uninstalled seed when the scope was never configured', async () => {
    getUserSettings.mockResolvedValue({
      tool: { uninstalledBuiltinTools: ['lobe-personal-gone'] },
    });

    // A workspace without its own slot gets the seed, never the personal list.
    await expect(
      createServerContextFactProviders(source({ origin: { workspaceId: 'ws-new' } }))
        .listUninstalledBuiltinIds!(),
    ).resolves.toEqual(defaultUninstalledBuiltinTools);

    getUserSettings.mockResolvedValue({});
    await expect(
      createServerContextFactProviders({
        ctx: { serverDB: {}, userId: 'owner-1' } as never,
        state: {} as never,
      }).listUninstalledBuiltinIds!(),
    ).resolves.toEqual(defaultUninstalledBuiltinTools);
    expect(defaultUninstalledBuiltinTools.length).toBeGreaterThan(0);
  });

  it('returns the app origin and the workspace slug when it resolves', async () => {
    findById.mockResolvedValue({ slug: 'team' });
    const providers = createServerContextFactProviders(source());

    await expect(providers.getWorkspaceContext!(undefined)).resolves.toEqual({
      appUrl: 'https://app.test',
    });
    await expect(providers.getWorkspaceContext!('ws-1')).resolves.toEqual({
      appUrl: 'https://app.test',
      slug: 'team',
    });
    findById.mockResolvedValue({ slug: null });
    await expect(providers.getWorkspaceContext!('ws-1')).resolves.toEqual({
      appUrl: 'https://app.test',
      slug: undefined,
    });
  });

  it('loads Share context documents only from the exact visitor topic scope', async () => {
    getAgentContextDocuments.mockResolvedValue([]);
    const providers = createServerContextFactProviders({
      ctx: {
        agentShareVisitor: {
          agentId: 'agent-1',
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
        serverDB: {},
        topicId: 'topic-fallback',
        userId: 'owner-1',
      } as never,
      state: { origin: { topicId: 'topic-1' } } as never,
    });

    await providers.listAgentDocuments!('agent-1');

    expect(agentDocumentsConstructor).toHaveBeenLastCalledWith(
      expect.anything(),
      'owner-1',
      undefined,
      undefined,
      {
        shareId: 'share-1',
        topicId: 'topic-1',
        type: 'agentShare',
        visitorUserId: 'visitor-1',
      },
    );
  });

  // Documents changed in an earlier turn must not re-render the index at the
  // front of the prompt while the cache is warm, or the whole cached
  // conversation behind it is written to the cache again.
  describe('agent-document index snapshot', () => {
    const reportRow = (contentCharCount: number, updatedAt: string) => ({
      content: '',
      contentCharCount,
      documentId: 'doc-1',
      filename: 'report.md',
      id: 'agent-doc-1',
      policyLoad: 'progressive',
      title: 'Report',
      updatedAt: new Date(updatedAt),
    });
    const turn = {
      cacheTtlMs: 5 * 60 * 1000,
      messages: [
        { createdAt: '2026-11-14T10:00:00.000Z', id: 'u1', role: 'user' },
        { createdAt: '2026-11-14T10:00:30.000Z', id: 'a1', role: 'assistant' },
        { createdAt: '2026-11-14T10:02:00.000Z', id: 'u2', role: 'user' },
      ],
    };
    const stored = {
      notes: [],
      rows: [
        {
          contentCharCount: 9400,
          filename: 'report.md',
          id: 'agent-doc-1',
          title: 'Report',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
      takenAt: '2026-11-14T10:00:00.000Z',
    };
    const providersFor = (state: Record<string, unknown>, bindAgentDocumentIndex = vi.fn()) =>
      createServerContextFactProviders({
        ctx: { bindAgentDocumentIndex, serverDB: {}, userId: 'owner-1' } as never,
        documentIndexTurn: turn,
        state: state as never,
      });

    beforeEach(() => {
      getAgentContextDocuments.mockReset();
      redisIndexGet.mockReset();
      redisIndexSet.mockReset();
    });

    it('continues the stored snapshot on a warm turn and notes the edit on the new user message', async () => {
      getAgentContextDocuments.mockResolvedValue([reportRow(14_100, '2026-11-14T10:00:20.000Z')]);
      redisIndexGet.mockResolvedValue(stored);
      const bindAgentDocumentIndex = vi.fn();
      const providers = providersFor({ origin: { topicId: 'topic-1' } }, bindAgentDocumentIndex);

      const [doc] = (await providers.listAgentDocuments!('agent-1'))!;
      const changes = await providers.listAgentDocumentChanges!('agent-1');

      expect(doc).toMatchObject({ contentCharCount: 9400, updatedAt: '2026-05-01T00:00:00.000Z' });
      expect(changes).toEqual({
        u2: [
          {
            contentCharCount: 14_100,
            id: 'agent-doc-1',
            kind: 'edited',
            title: 'Report',
            updatedAt: '2026-11-14T10:00:20.000Z',
          },
        ],
      });
      expect(getAgentContextDocuments).toHaveBeenCalledTimes(1);
      expect(redisIndexGet).toHaveBeenCalledWith({
        agentId: 'agent-1',
        threadId: undefined,
        topicId: 'topic-1',
      });
      expect(redisIndexSet).toHaveBeenCalledTimes(1);
      expect(bindAgentDocumentIndex).toHaveBeenCalledWith(redisIndexSet.mock.calls[0][1]);
    });

    it('renders later steps from the pinned snapshot without reading the stored one', async () => {
      getAgentContextDocuments.mockResolvedValue([reportRow(14_100, '2026-11-14T10:00:20.000Z')]);
      const bindAgentDocumentIndex = vi.fn();
      const providers = providersFor(
        { binding: { agentDocumentIndex: stored }, origin: { topicId: 'topic-1' } },
        bindAgentDocumentIndex,
      );

      const [doc] = (await providers.listAgentDocuments!('agent-1'))!;

      expect(doc).toMatchObject({ contentCharCount: 9400 });
      expect(redisIndexGet).not.toHaveBeenCalled();
      expect(redisIndexSet).not.toHaveBeenCalled();
      expect(bindAgentDocumentIndex).not.toHaveBeenCalled();
    });

    it('renders the live documents when the snapshot cannot be resolved', async () => {
      getAgentContextDocuments.mockResolvedValue([reportRow(14_100, '2026-11-14T10:00:20.000Z')]);
      redisIndexGet.mockRejectedValue(new Error('redis down'));
      const providers = providersFor({ origin: { topicId: 'topic-1' } });

      const [doc] = (await providers.listAgentDocuments!('agent-1'))!;

      expect(doc).toMatchObject({ contentCharCount: 14_100 });
      expect(await providers.listAgentDocumentChanges!('agent-1')).toBeUndefined();
    });

    it('renders the live documents for a host that passes no turn', async () => {
      getAgentContextDocuments.mockResolvedValue([reportRow(14_100, '2026-11-14T10:00:20.000Z')]);
      const providers = createServerContextFactProviders(source());

      const [doc] = (await providers.listAgentDocuments!('agent-1'))!;

      expect(doc).toMatchObject({ contentCharCount: 14_100 });
      expect(redisIndexGet).not.toHaveBeenCalled();
    });
  });

  describe('resolveSandboxPersistence', () => {
    // Regression: this provider read the raw context id while every other fact
    // here is scoped to the run's workspace. On the paths that do not carry it,
    // the topic was looked up in the personal scope and came back missing, so a
    // run with a persistent instance was described to the model as disposable —
    // and the model, told its files would not survive, worked in /tmp.
    it('scopes the lookup to the run workspace, not the raw context', async () => {
      mockResolveSandboxSessionConfig.mockResolvedValueOnce({
        claim: { key: 'ws-org-ws-from-origin', quotaBytes: 1024 },
        cwd: 'lobehub-dev',
        mode: 'persistent',
      } as never);

      const providers = createServerContextFactProviders({
        ctx: { serverDB: {}, topicId: 'tpc_1', userId: 'owner-1' } as never,
        state: { origin: { workspaceId: 'ws-from-origin' } } as never,
      });

      await expect(providers.resolveSandboxPersistence!()).resolves.toEqual({
        cwd: 'lobehub-dev',
        mode: 'persistent',
        workingDir: undefined,
      });
      expect(mockResolveSandboxSessionConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ topicId: 'tpc_1', workspaceId: 'ws-from-origin' }),
      );
    });
  });
});
