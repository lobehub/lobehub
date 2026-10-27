import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpInputRequiredError } from '@lobechat/mcp-elicitation';
import { afterEach, describe, expect, it } from 'vitest';

import { startNegotiationServers } from '../../../../../../src/libs/mcp/__tests__/fixtures/negotiationServers';
import { MCPClient } from './client';

describe('desktop transport protocol policy', () => {
  const clients: MCPClient[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
  });

  it.each([
    ['/modern', 'modern'],
    ['/legacy', 'legacy'],
  ] as const)('negotiates %s over HTTP', async (path, era) => {
    const servers = await startNegotiationServers();
    const client = new MCPClient({ name: 'desktop', type: 'http', url: servers.url + path });
    clients.push(client);
    try {
      await client.initialize();
      expect(client.getProtocolEra()).toBe(era);
      expect(await client.listManifests()).toMatchObject({
        title: 'Negotiation fixture',
        version: '1.2.3',
      });
      expect(await client.callTool('echo', {})).toMatchObject({
        content: [{ text: 'MCP negotiation tool succeeded', type: 'text' }],
      });
      if (era === 'modern') {
        await expect(client.callTool('needs_input', {})).rejects.toBeInstanceOf(
          McpInputRequiredError,
        );
      }
    } finally {
      await client.disconnect();
      await servers.close();
    }
  });

  it('starts one stdio child and sends initialize directly, without a discovery probe', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcp-stdio-negotiation-'));
    const trace = path.join(dir, 'wire.txt');
    const client = new MCPClient({
      name: 'desktop-stdio',
      type: 'stdio',
      command: process.execPath,
      args: [
        fileURLToPath(
          new URL(
            '../../../../../../src/libs/mcp/__tests__/fixtures/legacyStdio.mjs',
            import.meta.url,
          ),
        ),
        trace,
      ],
    });
    clients.push(client);
    try {
      await client.initialize();
      expect(client.getProtocolEra()).toBe('legacy');
      await expect(client.callTool('echo', {})).resolves.toMatchObject({
        content: [{ text: 'Stdio MCP tool succeeded', type: 'text' }],
      });
      await client.disconnect();
      const wire = await readFile(trace, 'utf8');
      expect(wire.match(/^spawn$/gm)).toHaveLength(1);
      expect(wire).toContain('"method":"initialize"');
      expect(wire).not.toContain('server/discover');
    } finally {
      await client.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
