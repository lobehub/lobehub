import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalBenchmarkModel } from '@/database/models/agentEval';
import { PluginModel } from '@/database/models/plugin';
import {
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalTestCases,
  userInstalledPlugins,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { collectMockPluginIds } from '@/server/services/agentEvalRun/casePlugins';

import { cleanupDB, serverDB, userId } from './_setup';

const mockGetManifest = vi.fn();
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    getStreamableMcpServerManifest: (...args: unknown[]) => mockGetManifest(...args),
  },
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: vi.fn() };
  }),
}));

const MOCK = 'http://mock.test';

const manifestOf = (identifier: string, url: string) => ({
  api: [{ description: `${identifier} tool`, name: `${identifier}_list`, parameters: {} }],
  identifier,
  mcpParams: { name: identifier, type: 'http', url },
  meta: { avatar: 'MCP_AVATAR', description: `${identifier} default`, title: identifier },
  type: 'mcp',
});

beforeEach(async () => {
  await cleanupDB();
  // The mock address is server configuration; the benchmark metadata below only carries presentation.
  vi.stubEnv('EVAL_TOOL_MOCK_BASE_URL', MOCK);
  mockGetManifest.mockReset();
  mockGetManifest.mockImplementation(async (identifier: string, url: string) =>
    manifestOf(identifier, url),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const createDataset = async (
  cases: Array<{ plugins?: string[]; services?: string[] }>,
  options: { datasetMock?: Record<string, unknown>; mock?: Record<string, unknown> | null } = {},
) => {
  const mock =
    options.mock === null
      ? undefined
      : (options.mock ?? {
          connectors: { gmail: { description: 'Reads and sends mail.', title: 'Gmail' } },
          dataset: 'bench30',
        });
  const benchmark = await new AgentEvalBenchmarkModel(serverDB, userId).create({
    identifier: 'bench',
    isSystem: false,
    metadata: { kind: 'lobe-bench', ...(mock && { mock }) },
    name: 'Bench',
    rubrics: [],
  });
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      identifier: 'bench-v1',
      name: 'Bench v1',
      userId,
      ...(options.datasetMock && { metadata: { mock: options.datasetMock } }),
    })
    .returning();

  for (const [index, item] of cases.entries()) {
    await serverDB.insert(agentEvalTestCases).values({
      content: {
        environment: {
          agent: { plugins: item.plugins ?? [], systemRole: 'You help.' },
          ...(item.services && { mock: { services: item.services } }),
        },
        input: `Case ${index + 1}`,
      },
      datasetId: dataset.id,
      sortOrder: index,
      userId,
    });
  }

  return { dataset };
};

const installedPlugins = () =>
  serverDB.select().from(userInstalledPlugins).where(eq(userInstalledPlugins.userId, userId));

const createRun = (datasetId: string) =>
  new AgentEvalRunService(serverDB, userId).createRun({
    config: { model: 'gpt-4.1-mini', provider: 'openai' },
    datasetId,
  });

describe('collectMockPluginIds', () => {
  it('lists the declared mock connectors the case Agents use, without builtin tools', () => {
    expect(
      collectMockPluginIds([
        {
          content: {
            environment: {
              agent: { plugins: ['twitter', 'lobe-web-browsing', 'notion'] },
              mock: { services: ['twitter', 'lobe-web-browsing', 'gmail'] },
            },
          },
        },
        {
          content: {
            environment: { agent: { plugins: ['gmail'] }, mock: { services: ['gmail'] } },
          },
        },
        { content: { environment: { agent: { plugins: ['shopify'] } } } },
        { content: {} },
      ]),
    ).toEqual(['gmail', 'twitter']);
  });
});

describe('AgentEvalRunService mock plugins', () => {
  it('installs the mock connectors the cases list, once each, from the benchmark mock', async () => {
    const { dataset } = await createDataset([
      {
        plugins: ['gmail', 'twitter', 'lobe-web-browsing'],
        services: ['gmail', 'twitter', 'lobe-web-browsing'],
      },
      { plugins: ['gmail'], services: ['gmail'] },
    ]);

    await createRun(dataset.id);

    expect(mockGetManifest).toHaveBeenCalledTimes(2);
    expect(mockGetManifest).toHaveBeenCalledWith(
      'gmail',
      `${MOCK}/mcp/bench30/gmail`,
      expect.objectContaining({ description: 'Reads and sends mail.' }),
    );

    const plugins = await installedPlugins();
    expect(plugins.map((p) => p.identifier).sort()).toEqual(['gmail', 'twitter']);

    const gmail = plugins.find((p) => p.identifier === 'gmail')!;
    expect(gmail.type).toBe('customPlugin');
    expect(gmail.customParams).toEqual({
      lobeBench: { url: `${MOCK}/mcp/bench30/gmail` },
      mcp: { type: 'http', url: `${MOCK}/mcp/bench30/gmail` },
    });
    expect(gmail.manifest?.api).toHaveLength(1);
    // The catalog's name reaches the prompt as the tool's name.
    expect(gmail.manifest?.meta?.title).toBe('Gmail');
    // A connector without a catalog entry keeps the product default.
    expect(plugins.find((p) => p.identifier === 'twitter')!.manifest?.meta?.title).toBe('twitter');
  });

  it('keeps plugins an earlier run installed from the same URL without re-reading them', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }]);

    await createRun(dataset.id);
    await createRun(dataset.id);

    expect(mockGetManifest).toHaveBeenCalledTimes(1);
    expect(await installedPlugins()).toHaveLength(1);
  });

  it('claims a plugin installed by hand from the same mock without re-reading it', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }]);
    const url = `${MOCK}/mcp/bench30/gmail`;
    await new PluginModel(serverDB, userId).create({
      customParams: { mcp: { type: 'http', url } },
      identifier: 'gmail',
      manifest: manifestOf('gmail', url) as any,
      type: 'customPlugin',
    });

    await createRun(dataset.id);

    expect(mockGetManifest).not.toHaveBeenCalled();
    const [gmail] = await installedPlugins();
    expect(gmail.customParams).toEqual({ lobeBench: { url }, mcp: { type: 'http', url } });
  });

  it('refreshes a mock plugin when the cases point at another discovery URL', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }], {
      datasetMock: { dataset: 'bench31' },
    });
    const oldUrl = `${MOCK}/mcp/bench30/gmail`;
    await new PluginModel(serverDB, userId).create({
      customParams: { lobeBench: { url: oldUrl }, mcp: { type: 'http', url: oldUrl } },
      identifier: 'gmail',
      manifest: manifestOf('gmail', oldUrl) as any,
      type: 'customPlugin',
    });

    await createRun(dataset.id);

    const newUrl = `${MOCK}/mcp/bench31/gmail`;
    expect(mockGetManifest).toHaveBeenCalledWith('gmail', newUrl, expect.anything());
    const [gmail] = await installedPlugins();
    expect(gmail.customParams?.mcp?.url).toBe(newUrl);
    expect(gmail.customParams?.lobeBench?.url).toBe(newUrl);
  });

  it('re-points a mock plugin an earlier run installed when the mock moved to another origin', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }]);
    // Installed by Lobe Bench while the mock still ran locally; the benchmark now names a public origin.
    const oldUrl = 'http://127.0.0.1:7440/mcp/bench30/gmail';
    await new PluginModel(serverDB, userId).create({
      customParams: { lobeBench: { url: oldUrl }, mcp: { type: 'http', url: oldUrl } },
      identifier: 'gmail',
      manifest: manifestOf('gmail', oldUrl) as any,
      type: 'customPlugin',
    });

    await createRun(dataset.id);

    const newUrl = `${MOCK}/mcp/bench30/gmail`;
    expect(mockGetManifest).toHaveBeenCalledWith('gmail', newUrl, expect.anything());
    const [gmail] = await installedPlugins();
    expect(gmail.customParams?.mcp?.url).toBe(newUrl);
    expect(gmail.customParams?.lobeBench?.url).toBe(newUrl);
  });

  it('ignores an address stored with the benchmark: connectors are read from the server mock', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }], {
      mock: { baseUrl: 'https://evil.example.com', dataset: 'bench30' },
    });

    await createRun(dataset.id);

    expect(mockGetManifest).toHaveBeenCalledWith(
      'gmail',
      `${MOCK}/mcp/bench30/gmail`,
      expect.anything(),
    );
    const [gmail] = await installedPlugins();
    expect(gmail.customParams?.mcp?.url).toBe(`${MOCK}/mcp/bench30/gmail`);
  });

  it('refuses to overwrite a plugin of the account that is not a mock connector', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }]);
    await new PluginModel(serverDB, userId).create({
      customParams: { mcp: { type: 'http', url: 'https://mail.example.com/mcp' } },
      identifier: 'gmail',
      manifest: manifestOf('gmail', 'https://mail.example.com/mcp') as any,
      type: 'customPlugin',
    });

    await expect(createRun(dataset.id)).rejects.toThrow(
      'Plugin "gmail" is already installed in this account and is not a mock connector',
    );
    expect(mockGetManifest).not.toHaveBeenCalled();
    // No run row is left behind.
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(0);
    const [gmail] = await installedPlugins();
    expect(gmail.customParams?.mcp?.url).toBe('https://mail.example.com/mcp');
  });

  it('fails run creation when the mock lists no tools for a connector', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }]);
    mockGetManifest.mockResolvedValue({ ...manifestOf('gmail', ''), api: [] });

    await expect(createRun(dataset.id)).rejects.toThrow('lists no tools');
    expect(await installedPlugins()).toHaveLength(0);
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(0);
  });

  it('fails run creation when the mock cannot be read', async () => {
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }]);
    mockGetManifest.mockRejectedValue(new Error('fetch failed'));

    await expect(createRun(dataset.id)).rejects.toThrow(
      `Could not read mock connector "gmail" from ${MOCK}/mcp/bench30/gmail: fetch failed`,
    );
  });

  it('fails run creation when cases list mock connectors but the server has no mock', async () => {
    vi.stubEnv('EVAL_TOOL_MOCK_BASE_URL', '');
    // A stored address does not help: it is not a trusted source.
    const { dataset } = await createDataset([{ plugins: ['gmail'], services: ['gmail'] }], {
      mock: { baseUrl: MOCK },
    });

    await expect(createRun(dataset.id)).rejects.toThrow('EVAL_TOOL_MOCK_BASE_URL');
    expect(mockGetManifest).not.toHaveBeenCalled();
  });

  it('installs nothing for cases without mock connectors', async () => {
    const { dataset } = await createDataset([{ plugins: ['shopify'] }], { mock: null });

    await createRun(dataset.id);

    expect(mockGetManifest).not.toHaveBeenCalled();
    expect(await installedPlugins()).toHaveLength(0);
  });
});
