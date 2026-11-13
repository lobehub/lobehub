// @vitest-environment node
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MCPClient } from '../client';
import { getMcpEventErrorName, MCP_EVENT_ERROR_CODES } from '../events/errors';
import { MCP_EVENTS_EXTENSION_ID } from '../events/schema';
import { startEventsServer } from './fixtures/eventsServer';

const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;

describe('MCP Events against a strict SDK HTTP server', () => {
  let server: Awaited<ReturnType<typeof startEventsServer>>;
  const clients: MCPClient[] = [];
  const connect = async (mcpEvents = true) => {
    const client = new MCPClient(
      {
        name: 'events-test',
        type: 'http',
        url: server.url,
        auth: { type: 'bearer', token: 'fixture-token' },
      },
      { mcpEvents },
    );
    clients.push(client);
    await client.initialize();
    return client;
  };
  beforeEach(async () => {
    server = await startEventsServer();
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.disconnect()));
    await server.close();
  });

  it('advertises the extension and lists every page', async () => {
    const client = await connect();
    expect(client.getEventsCapability()).toMatchObject({ supported: true });
    expect(await client.listEvents()).toMatchObject([
      { name: 'issue.created' },
      { name: '告警.发生' },
    ]);
    const pages = server.requests.filter((request) => request.method === 'events/list');
    expect(pages).toHaveLength(2);
    expect(pages[1].params.cursor).toBe('second');
    expect(pages[0].params._meta).toMatchObject({
      'io.modelcontextprotocol/clientCapabilities': {
        extensions: { [MCP_EVENTS_EXTENSION_ID]: {} },
      },
    });
  });

  it('does not advertise or allow events with the flag off', async () => {
    const client = await connect(false);
    expect(client.getEventsCapability().supported).toBe(false);
    await expect(client.listEvents()).rejects.toThrow(/Unsupported/);
    expect(server.requests.some((request) => request.method.startsWith('events/'))).toBe(false);
    expect(server.requests[0].params._meta).not.toMatchObject({
      'io.modelcontextprotocol/clientCapabilities': {
        extensions: { [MCP_EVENTS_EXTENSION_ID]: {} },
      },
    });
  });

  it('uses raw discover capabilities for draft servers whose top-level events was stripped by the SDK', async () => {
    await server.close();
    server = await startEventsServer({ legacyCapability: true });
    const client = await connect();
    expect(client.getEventsCapability()).toEqual({ supported: true, listChanged: true });
    expect((await client.listEvents()).length).toBe(2);
    expect(server.requests.filter((request) => request.method === 'server/discover')).toHaveLength(
      1,
    );
  });

  it.each(['issue.created', '告警.发生'])(
    'subscribes and unsubscribes %s with the required name header',
    async (name) => {
      const client = await connect();
      expect(
        await client.subscribeEvent({
          name,
          arguments: {},
          delivery: { mode: 'webhook', url: 'https://receiver.example/callback', secret },
          cursor: null,
          ttlMs: null,
        }),
      ).toMatchObject({ id: 'remote-fixture', refreshBefore: null, cursor: 'cursor-1' });
      await expect(
        client.unsubscribeEvent({
          name,
          arguments: {},
          delivery: { mode: 'webhook', url: 'https://receiver.example/callback' },
        }),
      ).resolves.toBeDefined();
      expect(
        server.requests.find((request) => request.method === 'events/subscribe')?.params.ttlMs,
      ).toBeNull();
    },
  );

  it.each(Object.keys(MCP_EVENT_ERROR_CODES))(
    'preserves %s errors through the error mapping',
    async (name) => {
      const client = await connect();
      const result = await client
        .subscribeEvent({
          name,
          delivery: { mode: 'webhook', url: 'https://receiver.example/callback', secret },
        })
        .catch((error: unknown) => error);
      expect(getMcpEventErrorName(result)).toBe(name);
    },
  );

  it('completes a verification callback and delivers a Standard Webhooks signed event', async () => {
    const received: unknown[] = [];
    const receiver = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(`${req.headers['webhook-id']}.${req.headers['webhook-timestamp']}.${body}`)
        .digest('base64');
      expect(req.headers['webhook-signature']).toBe(`v1,${expected}`);
      const payload = JSON.parse(body);
      received.push(payload);
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(
          JSON.stringify(payload.type === 'verification' ? { challenge: payload.challenge } : {}),
        );
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const address = receiver.address();
    if (!address || typeof address === 'string') throw new Error('No receiver address');
    try {
      const client = await connect();
      await client.subscribeEvent({
        name: 'issue.created',
        arguments: { verify: true },
        delivery: { mode: 'webhook', url: `http://127.0.0.1:${address.port}/inbound`, secret },
        ttlMs: null,
      });
      const payload = {
        eventId: 'evt-1',
        name: 'issue.created',
        timestamp: new Date().toISOString(),
        data: { issue: 123 },
        cursor: 'c2',
      };
      expect((await server.send(payload)).status).toBe(200);
      expect(received).toEqual([{ type: 'verification', challenge: 'fixture-challenge' }, payload]);
    } finally {
      receiver.closeAllConnections();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });
});
