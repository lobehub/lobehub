import { fileURLToPath } from 'node:url';

import { getMcpFormDefaults } from '@lobechat/mcp-elicitation/form';
import { afterEach, describe, expect, it } from 'vitest';

import { startElicitationServers } from '../../../../../../src/libs/mcp/__tests__/fixtures/elicitationServers';
import { MCPClient } from './client';

const clients: MCPClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.disconnect()));
});
describe('native MCP elicitation protocol', () => {
  it.each(['/modern', '/legacy'])(
    'continues multi-round HTTP on %s with the same host',
    async (path) => {
      const servers = await startElicitationServers();
      try {
        const client = new MCPClient(
          {
            type: 'http',
            name: 'desktop-elicitation',
            url: servers.url + path,
          },
          true,
        );
        clients.push(client);
        await client.initialize();
        let prompts = 0;
        const result = await client.callTool(
          'multi',
          {},
          {
            host: {
              request: async (request) => {
                prompts++;
                return { action: 'accept', content: getMcpFormDefaults(request) };
              },
            },
          },
        );
        expect(result.isError).not.toBe(true);
        expect(prompts).toBe(path === '/modern' ? 3 : 2);
        expect(servers.effects).toHaveLength(1);
      } finally {
        await Promise.all(clients.splice(0).map((client) => client.disconnect()));
        await servers.close();
      }
    },
  );
  it.each(['accept', 'decline', 'cancel'] as const)(
    'sends %s over a real legacy stdio child',
    async (action) => {
      const client = new MCPClient(
        {
          type: 'stdio',
          name: 'desktop-stdio',
          command: process.execPath,
          args: [
            fileURLToPath(
              new URL(
                '../../../../../../src/libs/mcp/__tests__/fixtures/legacyElicitationStdio.mjs',
                import.meta.url,
              ),
            ),
          ],
        },
        true,
      );
      clients.push(client);
      await client.initialize();
      const result = await client.callTool(
        'form',
        {},
        {
          host: {
            request: async () => ({
              action,
              ...(action === 'accept' && { content: { label: 'native' } }),
            }),
          },
        },
      );
      expect(result.content).toEqual([
        { type: 'text', text: action === 'accept' ? 'saved:native' : action },
      ]);
    },
  );
});
