import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LinqApiClient,
  LinqWebhookDeduplicator,
  signLinqWebhookPayload,
  verifyLinqWebhookRequest,
} from './index';

/**
 * Wire-level end-to-end check against a **real HTTP mock of Linq's v3 API**.
 *
 * Unlike the per-module tests (which stub `fetch`), this exercises the actual
 * request bytes LobeHub sends and the actual signature Linq would send back:
 * real `http.createServer`, real `fetch`, real HMAC. That is what makes it a
 * substitute for the live Linq account we cannot provision here.
 */

const SECRET = `whsec_${Buffer.from('linq-wire-smoke-secret').toString('base64')}`;
const FROM = '+15550000001';
const TO = '+15550000002';

interface RecordedRequest {
  auth?: string;
  body: string;
  method: string;
  path: string;
}

const recorded: RecordedRequest[] = [];

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
};

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = await readBody(req);
    recorded.push({
      auth: req.headers.authorization,
      body,
      method: req.method ?? '',
      path: url.pathname,
    });

    const json = (payload: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    // Linq v3 surface used by the adapter.
    if (req.method === 'GET' && url.pathname === '/v3/chats') {
      return json({ chats: [{ id: 'chat-1', is_group: false }] });
    }
    if (req.method === 'POST' && url.pathname === '/v3/chats') {
      return json({ chat: { id: 'chat-1', is_group: false } });
    }
    if (req.method === 'POST' && url.pathname === '/v3/chats/chat-1/messages') {
      return json({ chat_id: 'chat-1', message: { id: 'msg-1' } });
    }
    if (req.method === 'POST' && url.pathname === '/v3/chats/chat-1/typing') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'DELETE' && url.pathname === '/v3/chats/chat-1/typing') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/v3/chats/chat-1/read') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/v3/attachments') {
      return json({
        attachment_id: 'att-1',
        http_method: 'PUT',
        required_headers: { 'content-type': 'image/png' },
        upload_url: `${base}/upload/att-1`,
      });
    }
    if (req.method === 'PUT' && url.pathname === '/upload/att-1') {
      res.writeHead(200);
      return res.end();
    }

    return json({ error: { code: 404, message: `unrouted ${req.method} ${url.pathname}` } }, 404);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const buildClient = () =>
  new LinqApiClient({ apiKey: 'linq-wire-key', baseUrl: `${base}/v3`, fromNumber: FROM });

/**
 * `body` is what the request carries; `signBody` is what the signature covers.
 * They differ only in the tampering case — signing the tampered body would make
 * it a legitimate delivery of different content, not an attack.
 */
const buildSignedWebhook = (params: { body: string; id: string; signBody?: string }) => {
  const timestamp = Math.floor(Date.now() / 1000);
  return new Request('https://app.lobehub.com/api/agent/messenger/webhooks/linq', {
    body: params.body,
    headers: {
      'webhook-id': params.id,
      'webhook-signature': signLinqWebhookPayload({
        body: params.signBody ?? params.body,
        id: params.id,
        secret: SECRET,
        timestamp,
      }),
      'webhook-timestamp': String(timestamp),
    },
    method: 'POST',
  });
};

describe('Linq wire smoke (real HTTP mock of api.linqapp.com/v3)', () => {
  it('drives the whole messenger surface over HTTP and rejects replayed deliveries', async () => {
    const client = buildClient();
    recorded.length = 0;

    // --- Outbound: find-or-open the chat, then send -------------------------
    await client.sendToHandle({ handle: TO, text: 'Daily brief' });

    // --- Typing / read receipts -------------------------------------------
    await client.startTyping('chat-1');
    await client.stopTyping('chat-1');
    await client.markRead('chat-1');

    // --- Attachment pre-upload + media send -------------------------------
    const attachmentId = await client.uploadAttachment({
      data: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
      name: 'chart.png',
    });
    await client.sendMessage('chat-1', [{ attachment_id: attachmentId, type: 'media' }]);

    // --- Inbound: verify a signed delivery, then reject its replay --------
    const deduplicator = new LinqWebhookDeduplicator();
    const body = JSON.stringify({
      data: { chat: { id: 'chat-1' }, direction: 'inbound', id: 'msg-in-1' },
      event_type: 'message.received',
    });

    const inbound = await verifyLinqWebhookRequest(buildSignedWebhook({ body, id: 'wh-1' }), {
      deduplicator,
      signingSecret: SECRET,
    });
    const replay = await verifyLinqWebhookRequest(buildSignedWebhook({ body, id: 'wh-1' }), {
      deduplicator,
      signingSecret: SECRET,
    });
    const tampered = await verifyLinqWebhookRequest(
      // Signature is valid for `body`, but the request carries a modified one.
      buildSignedWebhook({ body: `${body} `, id: 'wh-2', signBody: body }),
      { deduplicator, signingSecret: SECRET },
    );

    console.log(
      [
        '--- Linq wire transcript (method path auth body) ---',
        ...recorded.map(
          (r) => `${r.method} ${r.path.replace(base, '')} ${r.auth ?? '-'} ${r.body || '-'}`,
        ),
        '--- webhook gate ---',
        `signed inbound      -> ok=${inbound.ok}`,
        `replayed webhook-id -> ok=${replay.ok} status=${replay.ok ? '-' : replay.response.status}`,
        `tampered body       -> ok=${tampered.ok} status=${tampered.ok ? '-' : tampered.response.status}`,
      ].join('\n'),
    );

    expect(recorded.map((r) => `${r.method} ${r.path.replace(base, '')}`)).toEqual([
      'GET /v3/chats',
      'POST /v3/chats/chat-1/messages',
      'POST /v3/chats/chat-1/typing',
      'DELETE /v3/chats/chat-1/typing',
      'POST /v3/chats/chat-1/read',
      'POST /v3/attachments',
      'PUT /upload/att-1',
      'POST /v3/chats/chat-1/messages',
    ]);

    // Every authenticated call carries the Bearer key; the presigned upload
    // must NOT (it is a public URL that already embeds its own signature).
    expect(recorded[0].auth).toBe('Bearer linq-wire-key');
    expect(recorded[6].auth).toBeUndefined();

    expect(inbound.ok).toBe(true);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.response.status).toBe(409);
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.response.status).toBe(401);
  });
});
