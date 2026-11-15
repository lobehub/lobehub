import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from '../McpCtr';

// The device gateway's `listMcpTools`: the server asks this desktop for the
// tools of an MCP server only this machine reaches, listed on the runtime the
// tunneled calls run on.

const { clientParams, mcpClientMocks } = vi.hoisted(() => ({
  clientParams: [] as unknown[],
  mcpClientMocks: vi.fn(),
}));

// The shared device MCP runtime lazily imports its client module; mock it so
// no real server is contacted
vi.mock('@lobechat/device-mcp/client', () => ({
  MCPClient: class {
    constructor(params: unknown) {
      clientParams.push(params);
      return mcpClientMocks();
    }
  },
  MCPConnectionError: class extends Error {
    name = 'MCPConnectionError';
    stderrLogs: string[] = [];
  },
}));

const mockApp = { getService: vi.fn(() => null) } as unknown as App;

const tools = [
  { inputSchema: { type: 'object' }, name: 'list_files' },
  { _meta: { ui: { visibility: ['app'] } }, inputSchema: { type: 'object' }, name: 'refresh' },
];

const makeClient = () => ({
  disconnect: vi.fn().mockResolvedValue(undefined),
  initialize: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue(tools),
});

describe('McpCtr.listToolsForGateway', () => {
  let ctr: McpCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    clientParams.length = 0;
    ctr = new McpCtr(mockApp);
  });

  it('lists an HTTP server on a one-off session with its credentials, returning every tool', async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.listToolsForGateway({
      mcpApps: true,
      params: {
        auth: { token: 'secret', type: 'bearer' },
        headers: { 'x-team': 'a' },
        name: 'nas',
        type: 'http',
        url: 'https://nas.tail1234.ts.net/mcp',
      },
    });

    // Raw, as listed: the server maps them into its manifest itself
    expect(result).toEqual(tools);
    expect(clientParams[0]).toMatchObject({
      auth: { token: 'secret', type: 'bearer' },
      headers: { 'x-team': 'a' },
      name: 'nas',
      type: 'http',
      url: 'https://nas.tail1234.ts.net/mcp',
    });
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects the HTTP session when listing fails', async () => {
    const client = makeClient();
    client.listTools.mockRejectedValue(new Error('unreachable'));
    mcpClientMocks.mockReturnValue(client);

    await expect(
      ctr.listToolsForGateway({
        params: { name: 'nas', type: 'http', url: 'https://nas.tail1234.ts.net/mcp' },
      }),
    ).rejects.toThrow('unreachable');
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('lists a stdio server on the pooled session its calls reuse', async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);
    const params = {
      args: ['mcp.js'],
      command: 'node',
      env: { TOKEN: 't' },
      name: 'files',
      type: 'stdio' as const,
    };

    await expect(ctr.listToolsForGateway({ params })).resolves.toEqual(tools);
    await expect(ctr.listToolsForGateway({ params })).resolves.toEqual(tools);

    // One process serves both listings, and stays up for the calls that follow
    expect(mcpClientMocks).toHaveBeenCalledOnce();
    expect(clientParams[0]).toMatchObject(params);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
