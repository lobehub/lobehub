import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

// A stdio MCP server with one MCP Apps view: `show` renders it, `frame` is
// app-only and returns an image block, as a view's high-frequency poll would.
const VIEW = 'ui://apps-fixture/view';
const server = new McpServer({ name: 'apps-stdio-fixture', version: '1.0.0' });
server.registerResource('view', VIEW, { mimeType: 'text/html;profile=mcp-app' }, async () => ({
  contents: [{ mimeType: 'text/html;profile=mcp-app', text: '<p>apps fixture</p>', uri: VIEW }],
}));
server.registerTool(
  'show',
  { _meta: { ui: { resourceUri: VIEW } }, description: 'Render the fixture view' },
  async () => ({ content: [{ text: 'shown', type: 'text' }] }),
);
server.registerTool(
  'frame',
  { _meta: { ui: { resourceUri: VIEW, visibility: ['app'] } }, description: 'App-only frame' },
  async () => ({
    content: [
      { text: 'frame', type: 'text' },
      { data: Buffer.from('frame-bytes').toString('base64'), mimeType: 'image/png', type: 'image' },
    ],
  }),
);
await server.connect(new StdioServerTransport());
