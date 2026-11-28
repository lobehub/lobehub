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

    expect(tools).toMatchObject([
      { inputSchema: { type: 'object' }, toolName: 'view', visibility: ['app'] },
      { description: 'Echo', toolName: 'echo', visibility: undefined },
    ]);
  });

  // The server keeps it only while the user's `mcp_apps` flag is on
  it("reports each tool's MCP Apps metadata, so its thread entrypoint syncs", async () => {
    mockListTools.mockResolvedValue({
      tools: [
        {
          _meta: {
            'lobehub/ui': {
              entrypoints: [{ type: 'thread' }],
              preferredModelDisplayMode: 'fullscreen',
            },
            'ui': { resourceUri: 'ui://screen/view' },
          },
          description: 'Show the screen',
          name: 'show_screen',
        },
        { description: 'Echo', name: 'echo' },
      ],
    });

    const [screen, echo] = await listLocalMcpTools({ type: 'http', url: 'http://127.0.0.1:9/mcp' });

    expect(screen.mcpAppMeta).toMatchObject({
      preferredModelDisplayMode: 'fullscreen',
      threadEntry: { toolName: 'show_screen' },
    });
    expect(echo.mcpAppMeta).not.toHaveProperty('threadEntry');
  });
});
