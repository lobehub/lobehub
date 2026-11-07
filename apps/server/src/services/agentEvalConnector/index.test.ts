import type { EvalConnectorBindings } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import {
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  userConnectors,
  users,
  workspaces,
} from '@/database/schemas';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import {
  AgentEvalConnectorService,
  EvalConnectorBindingError,
  getLobeBenchForwardingEndpoint,
} from './index';

const mocked = vi.hoisted(() => ({
  callTool: vi.fn(),
  fetch: vi.fn(),
  listRawTools: vi.fn(),
  gateKeeper: {
    decrypt: vi.fn(async (ciphertext: string) => ({
      plaintext: ciphertext.replace(/^sealed:/, ''),
    })),
    encrypt: vi.fn(async (plaintext: string) => `sealed:${plaintext}`),
  },
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: mocked }));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mocked.fetch }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => mocked.gateKeeper },
}));

const db = await getTestDB();
const userId = 'eval-connector-user';
const datasetId = 'eval-connector-dataset';
const model = () =>
  ConnectorModel.forEvaluation(db, userId, datasetId, undefined, mocked.gateKeeper);
const service = () => new AgentEvalConnectorService(db, userId, datasetId);
const originals = (bindings: EvalConnectorBindings) =>
  Object.fromEntries(
    Object.keys(bindings).map((identifier) => [
      identifier,
      {
        identifier,
        type: 'mcp' as const,
        meta: { title: identifier, description: 'Original service' },
        api: [{ name: 'read', description: 'Read a fixture', parameters: { type: 'object' } }],
      },
    ]),
  );
const check = (bindings: EvalConnectorBindings) =>
  service().checkBindings(bindings, originals(bindings));
const rawTools = [{ description: 'Read a fixture', inputSchema: { type: 'object' }, name: 'read' }];
const create = async (token = 'alpha-secret', url = 'https://mock.test/mcp/dataset/notion') =>
  model().create({
    credentials: JSON.stringify({ token, type: 'bearer' }),
    identifier: `imported-${crypto.randomUUID()}`,
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: url,
    metadata: { agentEval: { datasetId } },
    name: 'Private fixture',
    sourceType: 'custom',
    status: 'disconnected',
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: 'other-eval-user' }]);
  await db.insert(agentEvalDatasets).values([
    { id: datasetId, identifier: datasetId, name: 'Dataset', userId },
    { id: 'other-dataset', identifier: 'other-dataset', name: 'Other Dataset', userId },
    {
      id: 'foreign-dataset',
      identifier: 'foreign-dataset',
      name: 'Foreign Dataset',
      userId: 'other-eval-user',
    },
  ]);
  mocked.listRawTools.mockResolvedValue(rawTools);
  mocked.callTool.mockResolvedValue({ content: 'fixture-result', success: true });
  mocked.fetch.mockImplementation(async () => new Response('', { status: 404 }));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(users);
});

describe('evaluation connector binding', () => {
  it('lists and resolves only this Dataset connections, excluding ordinary and same-owner other Dataset rows', async () => {
    const own = await create();
    const ordinary = await new ConnectorModel(db, userId).create({
      identifier: 'notion',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://real.test/mcp',
      name: 'Notion',
      sourceType: 'custom',
      status: 'connected',
    });
    const other = await ConnectorModel.forEvaluation(db, userId, 'other-dataset').create({
      identifier: 'other-mock',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mock.test/mcp/other/notion',
      metadata: { agentEval: { datasetId: 'other-dataset' } },
      name: 'Notion',
      sourceType: 'custom',
      status: 'connected',
    });
    expect((await service().listAvailableConnectors()).map(({ id }) => id)).toEqual([own.id]);
    for (const connector of [ordinary, other]) {
      const bindings = { notion: { connectorId: connector.id } };
      await expect(service().validateBindings(bindings)).rejects.toThrow('unavailable');
      await expect(service().checkBindings(bindings)).rejects.toThrow('unavailable');
    }
    expect(mocked.listRawTools).not.toHaveBeenCalled();
    expect(mocked.callTool).not.toHaveBeenCalled();
  });

  it('fails closed on missing, mixed, or wrong frozen Dataset scopes before execution', async () => {
    const own = await create();
    const { snapshots } = await check({ notion: { connectorId: own.id } });
    const legacy = { notion: { ...snapshots.notion, datasetId: undefined } };
    const other = { notion: { ...snapshots.notion, datasetId: 'other-dataset' } };
    const mixed = { ...snapshots, other: other.notion };
    for (const snapshot of [legacy, other, mixed]) {
      await expect(
        service().execute('notion', snapshot, { apiName: 'read', args: '{}' }),
      ).rejects.toBeInstanceOf(EvalConnectorBindingError);
    }
    expect(mocked.callTool).not.toHaveBeenCalled();
  });

  it('does not expose or execute a foreign Dataset even for a matching connector marker', async () => {
    const foreign = await ConnectorModel.forEvaluation(
      db,
      'other-eval-user',
      'foreign-dataset',
    ).create({
      identifier: 'foreign-mock',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mock.test/mcp/foreign/notion',
      metadata: { agentEval: { datasetId: 'foreign-dataset' } },
      name: 'Notion',
      sourceType: 'custom',
      status: 'connected',
    });
    const unavailableService = new AgentEvalConnectorService(db, userId, 'foreign-dataset');
    expect(await unavailableService.listAvailableConnectors()).toEqual([]);
    await expect(
      unavailableService.validateBindings({ notion: { connectorId: foreign.id } }),
    ).rejects.toThrow('unavailable');
    const own = await create();
    await db
      .update(userConnectors)
      .set({ metadata: { agentEval: { datasetId: 'foreign-dataset' } } })
      .where(eq(userConnectors.id, own.id));
    // Matching connection owner + marker cannot substitute for Dataset access.
    await expect(
      unavailableService.validateBindings({ notion: { connectorId: own.id } }),
    ).rejects.toThrow('unavailable');
    expect(await unavailableService.listAvailableConnectors()).toEqual([]);
    expect(mocked.listRawTools).not.toHaveBeenCalled();
  });

  it('rejects legacy snapshots instead of deriving a new model contract from the mock', async () => {
    const connector = await create();
    const bindings = { notion: { connectorId: connector.id } };
    const { snapshots } = await service().checkBindings(bindings);
    await expect(service().resolveBindings(bindings, snapshots)).rejects.toThrow(
      'no original tool contract',
    );
    expect(mocked.callTool).not.toHaveBeenCalled();
  });

  it('uses the frozen original tool surface, never the connection display name', async () => {
    const connector = await create();
    await model().update(connector.id, { name: 'LobeBench Mock · private-name' });
    const bindings = { notion: { connectorId: connector.id } };
    const original = {
      identifier: 'notion',
      type: 'mcp' as const,
      meta: { title: 'Notion', description: 'Search and edit your workspace.' },
      api: [{ name: 'read', description: 'Read a page.', parameters: { type: 'object' } }],
      systemRole: 'Use the original workspace tools.',
    };
    const { snapshots, manifests } = await service().checkBindings(bindings, { notion: original });
    expect(manifests).toEqual([original]);
    expect(snapshots.notion.manifest).toEqual(original);
    expect(JSON.stringify({ manifests, snapshots })).not.toContain('LobeBench Mock');
  });

  it('bounds batch preflights to four connections and serializes transports of the same connection', async () => {
    const connections = [];
    for (let i = 0; i < 8; i++) {
      connections.push(await create(`token-${i}`, `https://mock.test/mcp/dataset/service-${i}`));
    }
    const groups: EvalConnectorBindings[] = connections.map((connector, i) => ({
      [`alias-${i}`]: { connectorId: connector.id },
    }));
    groups.push({
      sameMcp: { connectorId: connections[0].id, transport: 'mcp' },
      bench: { connectorId: connections[0].id, transport: 'lobe-bench' },
    });
    let active = 0;
    let maximum = 0;
    let sameConnectionMaximum = 0;
    const activeByUrl = new Map<string, number>();
    const release: Array<() => void> = [];
    let released = false;
    mocked.listRawTools.mockImplementation(async ({ url }: { url: string }) => {
      active++;
      maximum = Math.max(maximum, active);
      activeByUrl.set(url, (activeByUrl.get(url) ?? 0) + 1);
      sameConnectionMaximum = Math.max(sameConnectionMaximum, activeByUrl.get(url)!);
      if (!released) await new Promise<void>((resolve) => release.push(resolve));
      active--;
      activeByUrl.set(url, activeByUrl.get(url)! - 1);
      return rawTools;
    });
    const current = service();
    const checking = current.checkBindingGroups(groups);
    try {
      await vi.waitFor(() => expect(mocked.listRawTools).toHaveBeenCalledTimes(4));
    } finally {
      released = true;
      release.forEach((resolve) => resolve());
    }
    await checking;
    expect(maximum).toBe(4);
    expect(sameConnectionMaximum).toBe(1);
    expect(mocked.listRawTools).toHaveBeenCalledTimes(9);
    expect(mocked.fetch).toHaveBeenCalledOnce();
    const { snapshots } = await current.resolveBindings(groups.at(-1)!);
    expect(snapshots.sameMcp.transport).toBe('mcp');
    expect(snapshots.bench.transport).toBe('lobe-bench');
    expect(snapshots.sameMcp.fingerprint).not.toBe(snapshots.bench.fingerprint);

    mocked.fetch.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(current.checkBindingGroups([groups.at(-1)!])).rejects.toThrow('HTTP 401');
    expect(mocked.listRawTools).toHaveBeenCalledTimes(11);
  });

  it('validates every alias before deduplicating a batch connection', async () => {
    const connector = await create();
    await expect(
      service().checkBindingGroups([
        { notion: { connectorId: connector.id } },
        { 'lobe-user-memory': { connectorId: connector.id } },
      ]),
    ).rejects.toThrow('cannot be bound');
    expect(mocked.listRawTools).not.toHaveBeenCalled();
  });

  it('syncs an imported connection and freezes only its UUID and tool fingerprint', async () => {
    const connector = await create();
    const bindings = { notion: { connectorId: connector.id } };
    const { snapshots, manifests } = await check(bindings);
    expect(manifests[0].identifier).toBe('notion');
    expect(manifests[0].api.map((tool) => tool.name)).toEqual(['read']);
    expect(snapshots.notion).toEqual({
      connectorId: connector.id,
      datasetId,
      fingerprint: expect.any(String),
      transport: 'mcp',
      manifest: originals(bindings).notion,
    });
    expect(JSON.stringify({ snapshots, manifests })).not.toMatch(
      /alpha-secret|https:|mcpParams|Authorization/,
    );
    expect(
      await service().execute('notion', snapshots, { apiName: 'read', args: '{}' }),
    ).toMatchObject({ content: 'fixture-result', success: true });
    expect(mocked.callTool.mock.calls[0][0].clientParams.auth.token).toBe('alpha-secret');
  });

  it('keeps two bindings to the same URL on their own credentials and permits token rotation', async () => {
    const first = await create('first-secret');
    const second = await create('second-secret');
    const bindings = { first: { connectorId: first.id }, second: { connectorId: second.id } };
    const { snapshots } = await check(bindings);
    await service().execute('first', snapshots, { apiName: 'read', args: '{}' });
    await service().execute('second', snapshots, { apiName: 'read', args: '{}' });
    await model().update(first.id, {
      credentials: JSON.stringify({ token: 'rotated-secret', type: 'bearer' }),
    });
    await service().execute('first', snapshots, { apiName: 'read', args: '{}' });
    expect(mocked.callTool.mock.calls.map(([call]) => call.clientParams.auth.token)).toEqual([
      'first-secret',
      'second-secret',
      'rotated-secret',
    ]);
  });

  it('rejects foreign, workspace, mounted, disabled, and non-HTTP connections', async () => {
    const own = await create();
    const other = await new ConnectorModel(db, 'other-eval-user').create({
      identifier: 'foreign',
      name: 'Foreign',
      sourceType: 'custom',
      status: 'connected',
    });
    await db
      .insert(workspaces)
      .values({ id: 'eval-workspace', name: 'WS', primaryOwnerId: userId, slug: 'eval-workspace' });
    const workspace = await new ConnectorModel(db, userId, 'eval-workspace').create({
      identifier: 'scoped',
      name: 'Workspace',
      sourceType: 'custom',
      status: 'connected',
    });
    for (const id of [other.id, workspace.id, crypto.randomUUID()]) {
      await expect(service().validateBindings({ notion: { connectorId: id } })).rejects.toThrow(
        'unavailable',
      );
    }
    for (const patch of [
      { metadata: { agentEval: { datasetId }, mountedByAgentId: 'another-agent' } },
      { metadata: { agentEval: { datasetId } }, isEnabled: false },
      { isEnabled: true, mcpConnectionType: 'stdio' as const },
    ]) {
      // Legacy rows can predate the model's stronger write restrictions.
      await db.update(userConnectors).set(patch).where(eq(userConnectors.id, own.id));
      await expect(service().validateBindings({ notion: { connectorId: own.id } })).rejects.toThrow(
        'unavailable',
      );
    }
    expect(mocked.callTool).not.toHaveBeenCalled();
  });

  it('blocks target and tool-permission drift instead of silently following a changed connection', async () => {
    const connector = await create();
    const bindings = { notion: { connectorId: connector.id } };
    const { snapshots } = await check(bindings);
    await model().update(connector.id, {
      credentials: null,
      mcpServerUrl: 'https://other.test/mcp/dataset/notion',
    });
    await expect(
      service().execute('notion', snapshots, { apiName: 'read', args: '{}' }),
    ).rejects.toThrow('changed');
    await model().update(connector.id, { mcpServerUrl: 'https://mock.test/mcp/dataset/notion' });
    const tools = ConnectorToolModel.forEvaluation(db, userId, datasetId);
    const [tool] = await tools.queryByConnector(connector.id);
    await tools.updatePermission(tool.id, 'needs_approval');
    await expect(
      service().execute('notion', snapshots, { apiName: 'read', args: '{}' }),
    ).rejects.toThrow('changed');
    await expect(service().resolveBindings(bindings)).rejects.toThrow('automatically permitted');
    expect(mocked.callTool).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'needs_approval'] as const)(
    'preserves %s permission when an upstream tool disappears and returns',
    async (permission) => {
      const connector = await create();
      const bindings = { notion: { connectorId: connector.id } };
      await check(bindings);
      const tools = ConnectorToolModel.forEvaluation(db, userId, datasetId);
      const [tool] = await tools.queryByConnector(connector.id);
      await tools.updatePermission(tool.id, permission);
      await expect(check(bindings)).rejects.toThrow('automatically permitted');
      expect((await tools.queryByConnector(connector.id))[0].permission).toBe(permission);
      mocked.listRawTools.mockResolvedValue([]);
      await expect(check(bindings)).rejects.toThrow('automatically permitted');
      expect((await tools.queryByConnector(connector.id))[0].permission).toBe(permission);
      mocked.listRawTools.mockResolvedValue(rawTools);
      await expect(check(bindings)).rejects.toThrow('automatically permitted');
      expect((await tools.queryByConnector(connector.id))[0].permission).toBe(permission);
    },
  );

  it('prunes missing auto tools only on explicit evaluation sync', async () => {
    const connector = await create();
    const bindings = { notion: { connectorId: connector.id } };
    await check(bindings);
    const tools = ConnectorToolModel.forEvaluation(db, userId, datasetId);
    mocked.listRawTools.mockResolvedValue([]);
    await syncConnectorToolsById(connector.id, {
      connectorModel: model(),
      connectorToolModel: tools,
    });
    expect(await tools.queryByConnector(connector.id)).toHaveLength(1);
    await expect(check(bindings)).rejects.toThrow('automatically permitted');
    expect(await tools.queryByConnector(connector.id)).toEqual([]);
  });

  it('uses only the selected LobeBench connection token and same-origin derived route', async () => {
    vi.stubEnv('EVAL_TOOL_FORWARDING_TOKEN', 'global-secret-must-not-be-used');
    const connector = await create(
      'connection-secret',
      'https://mock.test/prefix/mcp/dataset/notion',
    );
    const { snapshots } = await check({
      logicalAlias: { connectorId: connector.id, transport: 'lobe-bench' },
    });
    mocked.fetch.mockResolvedValueOnce(
      Response.json({ data: { content: 'ok', success: true }, success: true }),
    );
    const result = await service().execute('logicalAlias', snapshots, {
      apiName: 'read',
      args: '{}',
      attemptId: 'attempt',
      caseId: 'case',
    });
    expect(result).toEqual({ content: 'ok', success: true });
    const [url, options] = mocked.fetch.mock.calls.at(-1)!;
    expect(url).toBe('https://mock.test/prefix/tool-exec/dataset/notion/exec');
    expect(options.headers.get('Authorization')).toBe('Bearer connection-secret');
    expect(options.redirect).toBe('manual');
    expect(JSON.parse(options.body)).toMatchObject({
      data: { identifier: 'notion' },
      metadata: { attemptId: 'attempt', caseId: 'case' },
    });
    expect(JSON.stringify(mocked.fetch.mock.calls)).not.toContain('global-secret');
  });

  it.each([401, 302])(
    'fails preflight on protected endpoint HTTP %i without following redirects',
    async (status) => {
      const connector = await create();
      mocked.fetch.mockResolvedValue(
        new Response('', { headers: { Location: 'https://other.test/steal' }, status }),
      );
      await expect(
        check({ notion: { connectorId: connector.id, transport: 'lobe-bench' } }),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(mocked.fetch).toHaveBeenCalledOnce();
      expect(mocked.fetch.mock.calls[0][1].redirect).toBe('manual');
      expect(mocked.callTool).not.toHaveBeenCalled();
    },
  );

  it('redacts unexpected provider errors during preflight', async () => {
    const connector = await create();
    mocked.listRawTools.mockRejectedValue(
      new Error('upstream printed alpha-secret and its private URL'),
    );
    await expect(check({ notion: { connectorId: connector.id } })).rejects.toThrow(
      'Could not verify',
    );
    await expect(check({ notion: { connectorId: connector.id } })).rejects.not.toThrow(
      'alpha-secret',
    );
  });

  it.each(['TimeoutError', 'AbortError'])(
    'identifies the failing binding without exposing the upstream %s message',
    async (name) => {
      const connector = await create();
      mocked.listRawTools.mockRejectedValue(
        Object.assign(new Error('alpha-secret at https://private.test/mcp'), { name }),
      );
      const failure = await service()
        .checkBindings({ notion: { connectorId: connector.id } })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EvalConnectorBindingError);
      expect((failure as Error).message).toContain('"notion"');
      expect((failure as Error).message).toContain(connector.id);
      expect((failure as Error).message).toMatch(/timed out|interrupted/);
      expect((failure as Error).message).not.toMatch(/alpha-secret|https:|private\.test/);
    },
  );

  it('identifies a shared connection when discovery leaves no permitted tools', async () => {
    const connector = await create();
    mocked.listRawTools.mockResolvedValue([]);
    const failure = await service()
      .checkBindingGroups([
        { firstAlias: { connectorId: connector.id } },
        { secondAlias: { connectorId: connector.id } },
      ])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EvalConnectorBindingError);
    expect((failure as Error).message).toContain(connector.id);
    expect((failure as Error).message).toContain('alias "firstAlias"');
    expect((failure as Error).message).toContain('no automatically permitted tools');
    expect((failure as Error).message).not.toMatch(/alpha-secret|https:|mock\.test/);
    expect(mocked.listRawTools).toHaveBeenCalledOnce();
  });
});

describe('LobeBench route derivation', () => {
  it.each([
    'https://mock.test/exec',
    'https://user:secret@mock.test/mcp/ds/service',
    'https://mock.test/mcp/ds/service?token=secret',
    'file:///mcp/ds/service',
  ])('rejects ambiguous forwarding target %s', (url) => {
    expect(() => getLobeBenchForwardingEndpoint(url)).toThrow();
  });
});

describe('connections stored in an Environment', () => {
  const environmentId = '00000000-0000-4000-8000-0000000000e1';
  const connectorId = `env:${environmentId}:gmail`;
  const contract = originals({ gmail: { connectorId } });
  const binding = { gmail: { connectorId, transport: 'lobe-bench' as const } };

  const environmentConfig = async () =>
    (await db.select().from(agentEvalEnvironments))[0].config as Record<string, unknown>;

  beforeEach(async () => {
    await db.insert(agentEvalEnvironments).values({
      config: {
        connections: {
          gmail: {
            credentials: 'sealed:{"token":"stored-secret","type":"bearer"}',
            name: 'Gmail mock',
            url: 'https://mock.test/mcp/dataset/gmail',
          },
        },
        connectorBindings: binding,
        mock: { services: ['gmail'] },
        toolManifests: contract,
      },
      id: environmentId,
      name: 'Shared world',
      userId,
    } as never);
    await db
      .insert(agentEvalTestCases)
      .values({ content: { input: 'Read my mail' }, datasetId, environmentId, userId });
  });

  it('resolves from the frozen contract without a connector row or tool discovery', async () => {
    const { manifests, snapshots } = await service().resolveBindings(binding, undefined, contract);
    expect(manifests.map((manifest) => manifest.identifier)).toEqual(['gmail']);
    expect(snapshots.gmail).toMatchObject({ connectorId, datasetId, transport: 'lobe-bench' });
    expect(JSON.stringify(snapshots)).not.toContain('stored-secret');
    expect(mocked.listRawTools).not.toHaveBeenCalled();
    expect(await db.select().from(userConnectors)).toHaveLength(0);
  });

  it('checks a stored connection without a separately supplied contract', async () => {
    await service().checkBindingGroups([binding]);
    const { manifests } = await service().checkBindings(binding);
    expect(manifests.map((manifest) => manifest.identifier)).toEqual(['gmail']);
  });

  it("checks a stored connection against the case's own contract when the Environment has none", async () => {
    // Hard 50: two contract variants of one service live in the cases, not in the shared Environment.
    await db
      .update(agentEvalEnvironments)
      .set({ config: { ...(await environmentConfig()), toolManifests: {} } } as never);
    await expect(service().checkBindingGroups([binding])).rejects.toThrow(
      'no original tool contract',
    );
    await service().checkBindingGroups([binding], [contract]);
  });

  it('authenticates the stored connection with its decrypted credentials', async () => {
    await service().checkBindings(binding, contract);
    const [url, init] = mocked.fetch.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/mock\.test\/sessions\/eval-connection-check-[\w-]+$/);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer stored-secret');
  });

  it('forwards a tool call to the mock for this case attempt', async () => {
    const { snapshots } = await service().resolveBindings(binding, undefined, contract);
    mocked.fetch.mockResolvedValueOnce(
      Response.json({ data: { content: 'inbox', success: true }, success: true }),
    );
    const result = await service().execute('gmail', snapshots, {
      apiName: 'read',
      args: '{}',
      attemptId: 'attempt-1',
      caseId: 'case-1',
    });
    expect(result).toEqual({ content: 'inbox', success: true });
    const [url, init] = mocked.fetch.mock.calls.at(-1)!;
    expect(url).toBe('https://mock.test/tool-exec/dataset/gmail/exec');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer stored-secret');
    expect(JSON.parse(init.body)).toMatchObject({
      data: { apiName: 'read', identifier: 'gmail' },
      metadata: { attemptId: 'attempt-1', caseId: 'case-1' },
    });
  });

  it('is unavailable to a Dataset whose cases do not use the Environment', async () => {
    const other = new AgentEvalConnectorService(db, userId, 'other-dataset');
    await expect(other.resolveBindings(binding, undefined, contract)).rejects.toBeInstanceOf(
      EvalConnectorBindingError,
    );
  });
});
