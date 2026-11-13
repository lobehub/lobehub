import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { toRecord } from '@lobechat/utils/object';
import { createMcpHandler, McpServer, ProtocolError } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { MCP_EVENT_ERROR_CODES } from '../../events/errors';
import { MCP_EVENTS_EXTENSION_ID } from '../../events/schema';

/** Real SDK server. It rejects missing/mismatching names and sends Standard Webhooks callbacks. */
export const startEventsServer = async ({
  legacyCapability = false,
  legacyProtocol = false,
} = {}) => {
  const requests: { method: string; name: string | null; params: Record<string, unknown> }[] = [];
  let callback: { secret: string; url: string } | undefined;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: 'events-fixture', version: '1.0.0' },
        {
          capabilities: { extensions: { [MCP_EVENTS_EXTENSION_ID]: {} } },
        },
      );
      server.server.setRequestHandler(
        'events/list',
        { params: z.looseObject({ cursor: z.string().optional() }) },
        async (params) => ({
          events: [
            {
              name: params.cursor ? '告警.发生' : 'issue.created',
              description: 'Fixture event',
              delivery: ['webhook'],
              inputSchema: { type: 'object' },
            },
          ],
          ...(!params.cursor && { nextCursor: 'second' }),
        }),
      );
      server.server.setRequestHandler(
        'events/subscribe',
        { params: z.looseObject({ name: z.string() }) },
        async (params) => {
          const error = MCP_EVENT_ERROR_CODES[params.name as keyof typeof MCP_EVENT_ERROR_CODES];
          if (error) throw new ProtocolError(error, params.name);
          const delivery = toRecord(params.delivery) ?? {};
          callback = { secret: String(delivery.secret), url: String(delivery.url) };
          if (params.arguments && toRecord(params.arguments)?.verify) {
            const response = await send({ type: 'verification', challenge: 'fixture-challenge' });
            if (toRecord(await response.json())?.challenge !== 'fixture-challenge')
              throw new Error('Challenge failed');
          }
          return { id: 'remote-fixture', refreshBefore: null, cursor: 'cursor-1' };
        },
      );
      server.server.setRequestHandler(
        'events/unsubscribe',
        { params: z.looseObject({ name: z.string() }) },
        async () => {
          callback = undefined;
          return {};
        },
      );
      return server;
    },
    { legacy: legacyProtocol ? 'allow' : 'reject' },
  );
  const send = async (
    payload: unknown,
    { timestamp = Math.floor(Date.now() / 1000), id = randomUUID() } = {},
  ) => {
    if (!callback) throw new Error('Not subscribed');
    const body = JSON.stringify(payload);
    const signature = createHmac(
      'sha256',
      Buffer.from(callback.secret.replace(/^whsec_/, ''), 'base64'),
    )
      .update(`${id}.${timestamp}.${body}`)
      .digest('base64');
    return fetch(callback.url, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': `v1,${signature}`,
        'x-mcp-subscription-id': 'remote-fixture',
      },
    });
  };
  const http = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const request = toRecord(body ? JSON.parse(body) : {}) ?? {};
      const params = toRecord(request.params) ?? {};
      const method = String(request.method);
      const headers = new Headers(req.headers as Record<string, string>);
      requests.push({ method, name: headers.get('mcp-name'), params });
      if (legacyProtocol && method === 'server/discover') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Method not found' },
          }),
        );
        return;
      }
      const sentName = headers.get('mcp-name');
      const encodedName = sentName?.match(/^=\?base64\?([A-Za-z0-9+/]+={0,2})\?=$/);
      const decodedName = encodedName
        ? Buffer.from(encodedName[1], 'base64').toString('utf8')
        : sentName;
      if (
        (method === 'events/subscribe' || method === 'events/unsubscribe') &&
        decodedName !== params.name
      ) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32020, message: 'HeaderMismatch' },
          }),
        );
        return;
      }
      let response = await handler.fetch(
        new Request('http://localhost/mcp', { method: req.method, headers, ...(body && { body }) }),
      );
      if (method === 'server/discover' && response.ok) {
        const raw = toRecord(await response.json()) ?? {};
        const result = toRecord(raw.result) ?? {};
        result.capabilities = legacyCapability
          ? { events: { listChanged: true }, unknownFixtureCapability: {} }
          : { ...toRecord(result.capabilities), unknownFixtureCapability: {} };
        response = Response.json({ ...raw, result });
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (error) {
      console.error('Events fixture failed', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    requests,
    send,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await handler.close();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
};
