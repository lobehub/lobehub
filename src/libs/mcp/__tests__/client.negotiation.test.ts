// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MCPClient } from '../client';
import { startNegotiationServers } from './fixtures/negotiationServers';

describe('HTTP protocol negotiation against SDK v2 servers', () => {
  let servers: Awaited<ReturnType<typeof startNegotiationServers>>;
  const clients: MCPClient[] = [];
  const clientAt = (path: string) => {
    const client = new MCPClient({
      name: 'negotiation-test',
      type: 'http',
      url: servers.url + path,
      auth: { type: 'oauth2', accessToken: 'fixture-connector-token' },
    });
    clients.push(client);
    return client;
  };
  beforeEach(async () => {
    servers = await startNegotiationServers();
  });

  it('keeps separate legacy sessions for fresh clients', async () => {
    const first = clientAt('/legacy');
    const second = clientAt('/legacy');
    await first.initialize();
    await second.initialize();
    await expect(first.callTool('echo', {})).resolves.toMatchObject({
      content: [{ type: 'text', text: 'MCP negotiation tool succeeded' }],
    });
    await expect(second.callTool('echo', {})).resolves.toMatchObject({
      content: [{ type: 'text', text: 'MCP negotiation tool succeeded' }],
    });
    const sessions = servers.requests
      .filter((r) => r.method === 'tools/call')
      .map((r) => r.session);
    expect(new Set(sessions).size).toBe(2);
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    await servers.close();
  });

  it.each([
    ['/modern', 'modern'],
    ['/legacy', 'legacy'],
  ] as const)('connects and calls %s', async (path, era) => {
    const client = clientAt(path);
    await client.initialize();
    expect(client.getProtocolEra()).toBe(era);
    expect(await client.listManifests()).toMatchObject({
      title: 'Negotiation fixture',
      version: '1.2.3',
      tools: expect.arrayContaining([expect.objectContaining({ name: 'echo' })]),
    });
    expect(await client.callTool('echo', {})).toMatchObject({
      content: [{ type: 'text', text: 'MCP negotiation tool succeeded' }],
    });
    expect(servers.requests.filter((r) => r.method === 'server/discover')).toHaveLength(1);
    expect(servers.requests.some((r) => r.method === 'initialize')).toBe(era === 'legacy');
    expect(
      servers.requests.every((r) => r.authorization === 'Bearer fixture-connector-token'),
    ).toBe(true);
    expect(servers.requests.some((r) => r.session !== null)).toBe(era === 'legacy');
  });

  it.each(['/401', '/403'])(
    'preserves authorization failure on %s without legacy fallback',
    async (path) => {
      await expect(clientAt(path).initialize()).rejects.toMatchObject({
        data: { type: 'AUTHORIZATION_ERROR' },
      });
      expect(servers.requests.map((r) => r.method)).toEqual(['server/discover']);
    },
  );

  it('reports a failed 5xx probe without legacy fallback', async () => {
    await expect(clientAt('/503').initialize()).rejects.toMatchObject({
      data: { type: 'CONNECTION_FAILED', message: expect.stringContaining('HTTP 503') },
    });
    expect(servers.requests.map((r) => r.method)).toEqual(['server/discover']);
  });

  it('reports an HTTP probe timeout', async () => {
    const client = clientAt('/timeout');
    // Use the real SDK timer with a short test budget; production uses its default.
    client['mcp'].setVersionNegotiation({ mode: 'auto', probe: { timeoutMs: 50 } });
    await expect(client.initialize()).rejects.toMatchObject({
      data: { type: 'INITIALIZATION_TIMEOUT', message: expect.stringContaining('timed out') },
    });
    expect(servers.requests.map((r) => r.method)).toEqual(['server/discover']);
  });

  it('completes an input_required call as a readable failed result without continuation', async () => {
    const client = clientAt('/modern');
    await client.initialize();
    await expect(client.callTool('needs_input', {})).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('requires user input') }],
    });
    expect(servers.requests.filter((r) => r.method === 'tools/call')).toHaveLength(1);
  });
});
