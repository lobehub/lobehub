/**
 * The runtime layer over a real socket: Node's own `fetch` (undici) against a
 * local HTTP server, so body cloning, abort signals, chunked SSE and multipart
 * encoding are exercised for real rather than through a mock `fetch`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLobeHub, LobeHubTimeoutError } from './index';

interface Seen {
  body: string;
  headers: IncomingMessage['headers'];
  method: string;
  url: string;
}

const seen: Seen[] = [];
let attempts = 0;
let endlessClosed = false;

const send = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const record = {
    body: Buffer.concat(chunks).toString('utf8'),
    headers: req.headers,
    method: req.method!,
    url: req.url!,
  };
  seen.push(record);
  const url = new URL(req.url!, 'http://local');

  if (url.pathname === '/api/v1/agents' && req.method === 'POST') {
    // Fail the first attempt so the keyed POST has to be resent with its body.
    if (++attempts === 1)
      return send(
        res,
        503,
        { code: 'service_unavailable', message: 'busy' },
        { 'Retry-After': '0' },
      );
    return send(res, 200, {
      data: { id: 'agt_1', title: JSON.parse(record.body).title },
      success: true,
    });
  }
  if (url.pathname === '/api/v1/agents') {
    const cursor = url.searchParams.get('cursor');
    return send(res, 200, {
      data: cursor
        ? { agents: [{ id: 'a2' }], hasMore: false, nextCursor: null, total: 2 }
        : { agents: [{ id: 'a1' }], hasMore: true, nextCursor: 'next', total: 2 },
      success: true,
    });
  }
  if (url.pathname === '/api/v1/topics') {
    // Never answers: lets the client-side timeout fire.
    return;
  }
  if (url.pathname === '/api/v1/responses' && JSON.parse(record.body).input === 'endless') {
    // An endless stream: only the client closing the connection ends it.
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let index = 0;
    const tick = setInterval(() => {
      res.write(
        `data: ${JSON.stringify({ delta: '.', sequence_number: index++, type: 'response.output_text.delta' })}\n\n`,
      );
    }, 10);
    res.on('close', () => {
      clearInterval(tick);
      endlessClosed = true;
    });
    return;
  }
  if (url.pathname === '/api/v1/responses') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events = [
      { delta: 'Hi', type: 'response.output_text.delta' },
      { delta: ' there', type: 'response.output_text.delta' },
      { response: { output_text: 'Hi there', status: 'completed' }, type: 'response.completed' },
    ];
    for (const [index, event] of events.entries()) {
      res.write(
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return res.end();
  }
  if (url.pathname === '/api/v1/files') {
    return send(res, 200, { data: { file: { id: 'file_1' } }, success: true });
  }
  send(res, 404, { code: 'not_found', message: 'nope', requestId: 'req_x', success: false });
});

let baseURL = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('over real HTTP', () => {
  it('resends a keyed POST with its body and the workspace / idempotency headers', async () => {
    const lobehub = createLobeHub({ apiKey: 'sk-lh-it', baseURL, workspaceId: 'ws_it' });

    const { data, error } = await lobehub.agents.create({
      body: { title: 'Retried' },
      idempotencyKey: 'it-key',
    });

    expect(error).toBeUndefined();
    expect(data?.data.title).toBe('Retried');
    const posts = seen.filter((entry) => entry.method === 'POST' && entry.url === '/api/v1/agents');
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(JSON.parse(post.body)).toEqual({ title: 'Retried' });
      expect(post.headers['idempotency-key']).toBe('it-key');
      expect(post.headers['x-workspace-id']).toBe('ws_it');
      expect(post.headers.authorization).toBe('Bearer sk-lh-it');
    }
  });

  it('paginates across real responses', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', baseURL });
    const ids: string[] = [];
    for await (const agent of lobehub.paginate(lobehub.agents.list)) ids.push(agent.id);
    expect(ids).toEqual(['a1', 'a2']);
  });

  it('times out a request whose headers never arrive', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', baseURL, maxRetries: 0, timeout: 50 });
    const { error } = await lobehub.topics.list();
    expect(error).toBeInstanceOf(LobeHubTimeoutError);
  });

  it('streams server-sent events as they are written', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', baseURL });
    let text = '';
    for await (const event of lobehub.responses.stream({ input: 'hi', model: 'agt_1' })) {
      if (event.type === 'response.output_text.delta') text += event.delta;
    }
    expect(text).toBe('Hi there');
  });

  it('closes a stream mid-body on abort() and on the caller signal', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', baseURL });

    for (const cancel of ['abort', 'signal'] as const) {
      endlessClosed = false;
      const caller = new AbortController();
      const stream = lobehub.responses.stream(
        { input: 'endless', model: 'agt_1' },
        { signal: caller.signal },
      );
      let received = 0;
      const consume = (async () => {
        for await (const _ of stream) {
          if (++received === 3) cancel === 'abort' ? stream.abort() : caller.abort();
        }
      })();

      // Aborting ends the loop with an AbortError instead of more events.
      await expect(consume).rejects.toMatchObject({ name: 'AbortError' });
      expect(received).toBeLessThan(10);
      await expect.poll(() => endlessClosed, { timeout: 2000 }).toBe(true);
    }
  });

  it('uploads multipart form data', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', baseURL, throwOnError: true });

    const { data } = await lobehub.files.upload(Buffer.from('real bytes'), { name: 'real.txt' });

    expect(data.data.file.id).toBe('file_1');
    const upload = seen.findLast((entry) => entry.url === '/api/v1/files')!;
    expect(upload.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(upload.body).toContain('filename="real.txt"');
    expect(upload.body).toContain('real bytes');
  });

  it('surfaces a real error answer as LobeHubAPIError', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', baseURL });
    const { error } = await lobehub.users.me();
    expect(error).toMatchObject({ code: 'not_found', requestId: 'req_x', status: 404 });
  });
});
