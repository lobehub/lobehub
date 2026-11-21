// @vitest-environment node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { MCP_EVENTS_EXTENSION_ID, McpSubscribeEventResultSchema } from '../events/schema';
import { startEventsServer } from './fixtures/eventsServer';

describe('SDK 2.4 capabilities boundary', () => {
  it('retains extensions but strips unknown top-level fields from server/discover', async () => {
    const fixture = await startEventsServer();
    const client = new Client(
      { name: 'probe', version: '1' },
      { versionNegotiation: { mode: 'auto' } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(fixture.url)));
      expect(client.getServerCapabilities()?.extensions?.[MCP_EVENTS_EXTENSION_ID]).toEqual({});
      expect(client.getServerCapabilities()).not.toHaveProperty('unknownFixtureCapability');
    } finally {
      await client.close();
      await fixture.close();
    }
  });
  it('rejects the unmodified SDK subscribe request because its name header is missing', async () => {
    const fixture = await startEventsServer();
    const client = new Client(
      { name: 'probe', version: '1' },
      {
        versionNegotiation: { mode: 'auto' },
        capabilities: { extensions: { [MCP_EVENTS_EXTENSION_ID]: {} } },
      },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(fixture.url)));
      await expect(
        client.request(
          {
            method: 'events/subscribe',
            params: {
              name: 'issue.created',
              delivery: {
                mode: 'webhook',
                url: 'https://example.com/callback',
                secret: 'whsec_fixture',
              },
            },
          },
          McpSubscribeEventResultSchema,
        ),
      ).rejects.toMatchObject({ code: -32020, message: 'HeaderMismatch' });
      expect(
        fixture.requests.find((request) => request.method === 'events/subscribe')?.name,
      ).toBeNull();
    } finally {
      await client.close();
      await fixture.close();
    }
  });
});
