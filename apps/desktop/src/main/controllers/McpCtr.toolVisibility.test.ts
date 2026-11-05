import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from './McpCtr';

const { mcpClientMocks } = vi.hoisted(() => ({ mcpClientMocks: vi.fn() }));

vi.mock('../libs/mcp/client', () => ({
  MCPClient: class {
    constructor(
      public params: unknown,
      options?: unknown,
    ) {
      return mcpClientMocks(options);
    }
  },
  MCPConnectionError: class extends Error {
    name = 'MCPConnectionError';
    stderrLogs: string[] = [];
  },
}));

const mockApp = { getService: vi.fn(() => null) } as unknown as App;

const tools = [
  { description: 'Show it', inputSchema: { type: 'object' }, name: 'show_dashboard' },
  {
    _meta: { ui: { visibility: ['app'] } },
    description: 'Next page',
    inputSchema: { type: 'object' },
    name: 'load_page',
  },
];

// Kept from the model's `api`, still known to the view-call policy
const appOnlyToolNames = ['load_page'];

const makeClient = () => ({
  disconnect: vi.fn().mockResolvedValue(undefined),
  initialize: vi.fn().mockResolvedValue(undefined),
  listManifests: vi.fn().mockResolvedValue({ tools }),
  listTools: vi.fn().mockResolvedValue(tools),
});

const http = { name: 'dash', url: 'http://localhost:4000/mcp' };
const stdio = { args: [], command: 'dash-mcp', name: 'dash' };

describe('McpCtr tool visibility', () => {
  let ctr: McpCtr;

  beforeEach(() => {
    vi.resetAllMocks();
    mcpClientMocks.mockImplementation(makeClient);
    ctr = new McpCtr(mockApp);
  });

  it.each([
    [
      'stdio manifest',
      (ctr: McpCtr) =>
        ctr.getStdioMcpServerManifest(serializeMcpIpcPayload({ ...stdio, mcpApps: true })),
    ],
    [
      'HTTP manifest',
      (ctr: McpCtr) =>
        ctr.getStreamableMcpServerManifest(
          serializeMcpIpcPayload({ identifier: 'dash', mcpApps: true, url: http.url }),
        ),
    ],
    [
      'stdio listing',
      (ctr: McpCtr) => ctr.listTools(serializeMcpIpcPayload({ mcpApps: true, stdio } as any)),
    ],
    [
      'HTTP listing',
      (ctr: McpCtr) => ctr.listTools(serializeMcpIpcPayload({ http, mcpApps: true } as any)),
    ],
  ])('discovers on a session announcing MCP Apps when on (%s)', async (_, discover) => {
    // A server may list the tools only its views call just to such a client
    await discover(ctr);

    expect(mcpClientMocks).toHaveBeenCalledWith({ mcpApps: true });
  });

  it('keeps view-only tools out of the stdio manifest the model reads', async () => {
    const manifest = deserializeMcpIpcPayload<any>(
      await ctr.getStdioMcpServerManifest(serializeMcpIpcPayload(stdio)),
    );

    expect(manifest.api.map((api: { name: string }) => api.name)).toEqual(['show_dashboard']);
    expect(manifest.meta.description).toBe('dash MCP server has 1 tool');
    expect(manifest.mcpAppOnlyApi.map((api: { name: string }) => api.name)).toEqual(
      appOnlyToolNames,
    );
  });

  it('keeps view-only tools out of the HTTP manifest the model reads', async () => {
    const manifest = deserializeMcpIpcPayload<any>(
      await ctr.getStreamableMcpServerManifest(
        serializeMcpIpcPayload({ identifier: 'dash', url: http.url }),
      ),
    );

    expect(manifest.api.map((api: { name: string }) => api.name)).toEqual(['show_dashboard']);
    expect(manifest.meta.description).toBe('dash MCP server has 1 tool, like "show_dashboard"');
    expect(manifest.mcpAppOnlyApi.map((api: { name: string }) => api.name)).toEqual(
      appOnlyToolNames,
    );
  });

  it.each([
    ['stdio', { stdio }],
    ['HTTP', { http }],
  ])('lists every %s tool with its declared visibility for connector sync', async (_, input) => {
    const listed = deserializeMcpIpcPayload<any>(
      await ctr.listTools(serializeMcpIpcPayload(input as any)),
    );

    expect(listed).toEqual([
      {
        description: 'Show it',
        inputSchema: { type: 'object' },
        name: 'show_dashboard',
        visibility: undefined,
      },
      {
        description: 'Next page',
        inputSchema: { type: 'object' },
        name: 'load_page',
        visibility: ['app'],
      },
    ]);
  });
});
