import { describe, expect, it, vi } from 'vitest';

import { listLocalMcpTools } from './localMcp';

const { mockListTools } = vi.hoisted(() => ({ mockListTools: vi.fn() }));

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    close = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockResolvedValue(undefined);
    listTools = mockListTools;
  },
  StreamableHTTPClientTransport: class {},
}));

describe('listLocalMcpTools', () => {
  it("forwards each tool's declared _meta.ui.visibility", async () => {
    mockListTools.mockResolvedValue({
      tools: [
        { _meta: { ui: { visibility: ['app'] } }, inputSchema: { type: 'object' }, name: 'view' },
        { description: 'Echo', name: 'echo' },
      ],
    });

    const tools = await listLocalMcpTools({ type: 'http', url: 'http://127.0.0.1:9000/mcp' });

    expect(tools).toEqual([
      { inputSchema: { type: 'object' }, toolName: 'view', visibility: ['app'] },
      { description: 'Echo', toolName: 'echo', visibility: undefined },
    ]);
  });
});
