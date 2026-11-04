import type { EvalConnectorBindings } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { users, workspaces } from '@/database/schemas';
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
const model = () => new ConnectorModel(db, userId, undefined, mocked.gateKeeper);
const service = () => new AgentEvalConnectorService(db, userId);
const rawTools = [{ description: 'Read a fixture', inputSchema: { type: 'object' }, name: 'read' }];
const create = async (token = 'alpha-secret', url = 'https://mock.test/mcp/dataset/notion') =>
  model().create({
    credentials: JSON.stringify({ token, type: 'bearer' }),
    identifier: `imported-${crypto.randomUUID()}`,
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: url,
    name: 'Private fixture',
    sourceType: 'custom',
    status: 'disconnected',
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: 'other-eval-user' }]);
  mocked.listRawTools.mockResolvedValue(rawTools);
  mocked.callTool.mockResolvedValue({ content: 'fixture-result', success: true });
  mocked.fetch.mockImplementation(async () => new Response('', { status: 404 }));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(users);
});

describe('evaluation connector binding', () => {
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
    const { snapshots, manifests } = await service().checkBindings(bindings);
    expect(manifests[0].identifier).toBe('notion');
    expect(manifests[0].api.map((tool) => tool.name)).toEqual(['read']);
    expect(snapshots.notion).toEqual({
      connectorId: connector.id,
      fingerprint: expect.any(String),
      transport: 'mcp',
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
    const { snapshots } = await service().checkBindings(bindings);
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
      { metadata: { mountedByAgentId: 'another-agent' } },
      { metadata: {}, isEnabled: false },
      { isEnabled: true, mcpConnectionType: 'stdio' as const },
    ]) {
      await model().update(own.id, patch);
      await expect(service().validateBindings({ notion: { connectorId: own.id } })).rejects.toThrow(
        'unavailable',
      );
    }
    expect(mocked.callTool).not.toHaveBeenCalled();
  });

  it('blocks target and tool-permission drift instead of silently following a changed connection', async () => {
    const connector = await create();
    const bindings = { notion: { connectorId: connector.id } };
    const { snapshots } = await service().checkBindings(bindings);
    await model().update(connector.id, { mcpServerUrl: 'https://other.test/mcp/dataset/notion' });
    await expect(
      service().execute('notion', snapshots, { apiName: 'read', args: '{}' }),
    ).rejects.toThrow('changed');
    await model().update(connector.id, { mcpServerUrl: 'https://mock.test/mcp/dataset/notion' });
    const tools = new ConnectorToolModel(db, userId);
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
      await service().checkBindings(bindings);
      const tools = new ConnectorToolModel(db, userId);
      const [tool] = await tools.queryByConnector(connector.id);
      await tools.updatePermission(tool.id, permission);
      await expect(service().checkBindings(bindings)).rejects.toThrow('automatically permitted');
      expect((await tools.queryByConnector(connector.id))[0].permission).toBe(permission);
      mocked.listRawTools.mockResolvedValue([]);
      await expect(service().checkBindings(bindings)).rejects.toThrow('automatically permitted');
      expect((await tools.queryByConnector(connector.id))[0].permission).toBe(permission);
      mocked.listRawTools.mockResolvedValue(rawTools);
      await expect(service().checkBindings(bindings)).rejects.toThrow('automatically permitted');
      expect((await tools.queryByConnector(connector.id))[0].permission).toBe(permission);
    },
  );

  it('prunes missing auto tools only on explicit evaluation sync', async () => {
    const connector = await create();
    const bindings = { notion: { connectorId: connector.id } };
    await service().checkBindings(bindings);
    const tools = new ConnectorToolModel(db, userId);
    mocked.listRawTools.mockResolvedValue([]);
    await syncConnectorToolsById(connector.id, {
      connectorModel: model(),
      connectorToolModel: tools,
    });
    expect(await tools.queryByConnector(connector.id)).toHaveLength(1);
    await expect(service().checkBindings(bindings)).rejects.toThrow('automatically permitted');
    expect(await tools.queryByConnector(connector.id)).toEqual([]);
  });

  it('uses only the selected LobeBench connection token and same-origin derived route', async () => {
    vi.stubEnv('EVAL_TOOL_FORWARDING_TOKEN', 'global-secret-must-not-be-used');
    const connector = await create(
      'connection-secret',
      'https://mock.test/prefix/mcp/dataset/notion',
    );
    const { snapshots } = await service().checkBindings({
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
        service().checkBindings({ notion: { connectorId: connector.id, transport: 'lobe-bench' } }),
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
    await expect(
      service().checkBindings({ notion: { connectorId: connector.id } }),
    ).rejects.toThrow('Could not verify');
    await expect(
      service().checkBindings({ notion: { connectorId: connector.id } }),
    ).rejects.not.toThrow('alpha-secret');
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
      expect((failure as Error).message).toMatch(/timed out|interrupted/);
      expect((failure as Error).message).not.toMatch(/alpha-secret|https:|private\.test/);
    },
  );
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
