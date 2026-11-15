import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from '../McpCtr';

const { mcpClientMocks } = vi.hoisted(() => ({
  mcpClientMocks: vi.fn(),
}));

// The shared device MCP runtime lazily imports its client module; mock it so
// no real stdio process is ever spawned.
vi.mock('@lobechat/device-mcp/client', () => ({
  MCPClient: class {
    constructor(public params: unknown) {
      return mcpClientMocks();
    }
  },
  MCPConnectionError: class extends Error {
    name = 'MCPConnectionError';
    stderrLogs: string[] = [];
  },
}));

const mockApp = {
  getService: vi.fn(() => null),
} as unknown as App;

const makeClientInstance = (label: string) => ({
  callTool: vi.fn().mockImplementation(async () => ({
    content: [{ text: `${label}-result`, type: 'text' }],
    isError: false,
  })),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getProtocolEra: vi.fn().mockReturnValue('legacy'),
  initialize: vi.fn().mockResolvedValue(undefined),
  listManifests: vi.fn().mockResolvedValue({ tools: [] }),
});

describe('McpCtr manifests', () => {
  let ctr: McpCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    mcpClientMocks.mockReset();
    ctr = new McpCtr(mockApp);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['My server description'])(
    'keeps stdio descriptions as metadata (%s)',
    async (description) => {
      const instance = {
        ...makeClientInstance('tools-only'),
        listManifests: vi.fn().mockResolvedValue({
          prompts: undefined,
          resources: undefined,
          tools: [{ inputSchema: { type: 'object' }, name: 'hello' }],
        }),
      };
      mcpClientMocks.mockReturnValue(instance);

      const result = await ctr.getStdioMcpServerManifest(
        serializeMcpIpcPayload({
          command: 'test-command',
          metadata: { description },
          name: 'tools-only',
        }),
      );
      const manifest = deserializeMcpIpcPayload<{ api: unknown[]; meta: { description?: string } }>(
        result,
      );

      expect(manifest.api).toHaveLength(1);
      expect(manifest.meta.description).toBe(description);
    },
  );

  it.each(['My server description'])(
    'keeps HTTP descriptions as metadata (%s)',
    async (description) => {
      const instance = { ...makeClientInstance('http'), listTools: vi.fn().mockResolvedValue([]) };
      mcpClientMocks.mockReturnValue(instance);

      const result = await ctr.getStreamableMcpServerManifest(
        serializeMcpIpcPayload({
          identifier: 'empty-server',
          metadata: { description },
          url: 'http://localhost/mcp',
        }),
      );
      const manifest = deserializeMcpIpcPayload<{ api: unknown[]; meta: { description?: string } }>(
        result,
      );

      expect(manifest.api).toEqual([]);
      expect(manifest.meta.description).toBe(description);
    },
  );

  it.each([
    {
      capabilities: { tools: [{ name: 'hello' }] },
      summary: '1 tool',
    },
    {
      capabilities: { prompts: [], resources: [], tools: [] },
      summary: 'no tools, prompts, or resources',
    },
    {
      capabilities: {
        prompts: [{ name: 'greet' }],
        resources: [{ name: 'readme' }],
        tools: [{ name: 'hello' }],
      },
      summary: '1 prompt, 1 resource, 1 tool',
    },
  ])('persists the automatic stdio description: $summary', async ({ capabilities, summary }) => {
    const instance = makeClientInstance('automatic');
    instance.listManifests.mockResolvedValue(capabilities);
    mcpClientMocks.mockReturnValue(instance);

    const result = await ctr.getStdioMcpServerManifest(
      serializeMcpIpcPayload({ command: 'test-command', name: 'automatic' }),
    );
    const manifest = deserializeMcpIpcPayload<{ meta: { description: string } }>(result);

    expect(manifest.meta.description).toBe(`automatic MCP server has ${summary}`);
    expect(manifest.meta.description).not.toContain('undefined');
  });

  it.each([
    { tools: [], summary: 'no tools, prompts, or resources' },
    { tools: [{ name: 'hello' }], summary: '1 tool, like "hello"' },
  ])('persists the automatic HTTP description: $summary', async ({ tools, summary }) => {
    mcpClientMocks.mockReturnValue({
      ...makeClientInstance('automatic'),
      listTools: vi.fn().mockResolvedValue(tools),
    });
    const result = await ctr.getStreamableMcpServerManifest(
      serializeMcpIpcPayload({ identifier: 'automatic', url: 'http://localhost/mcp' }),
    );
    const manifest = deserializeMcpIpcPayload<{ meta: { description: string } }>(result);

    expect(manifest.meta.description).toBe(`automatic MCP server has ${summary}`);
    expect(manifest.meta.description).not.toContain('undefined');
  });

  it('evicts the pooled client when listManifests fails on a stale session', async () => {
    const seeded = makeClientInstance('seeded');
    seeded.listManifests.mockRejectedValue(
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
    );
    mcpClientMocks.mockReturnValue(seeded);

    await expect(
      ctr.getStdioMcpServerManifest({
        args: ['--stdio'],
        command: 'ida-mcp',
        name: 'ida-mcp',
      } as any),
    ).rejects.toThrow('Connection closed');

    // Broken session evicted + disconnected, so the next refresh starts fresh.
    expect(seeded.disconnect).toHaveBeenCalledTimes(1);
  });
});
