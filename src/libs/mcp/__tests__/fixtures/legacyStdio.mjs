import { appendFile } from 'node:fs/promises';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const trace = process.argv[2];
if (trace) {
  await appendFile(trace, 'spawn\n');
  process.stdin.on('data', (chunk) => {
    // Capture wire bytes without delaying the SDK's stdin listener.
    appendFile(trace, chunk).catch((error) => console.error(error));
  });
}
const server = new McpServer({ name: 'legacy-stdio-fixture', version: '1.0.0' });
server.registerTool('echo', { description: 'Return a stdio acceptance marker' }, async () => ({
  content: [{ type: 'text', text: 'Stdio MCP tool succeeded' }],
}));
await server.connect(new StdioServerTransport());
