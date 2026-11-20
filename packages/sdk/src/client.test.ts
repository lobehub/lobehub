import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Agent, ResponseStreamEvent } from './index';
import { createLobeHub, LobeHubAPIError, LobeHubConnectionError } from './index';

type Handler = (request: Request) => Response | Promise<Response>;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const envelope = (data: unknown) => ({ data, success: true, timestamp: '2026-01-01T00:00:00Z' });

/** A mock `fetch` answering from `handler`, recording every request it saw. */
const mockFetch = (handler: Handler) => {
  const requests: Request[] = [];
  const fetch = (async (input: Request) => {
    requests.push(input);
    return handler(input);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
};

const apiError = (
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  json(
    {
      code,
      error: 'boom',
      message: 'boom',
      requestId: 'req_123',
      success: false,
      timestamp: '2026-01-01T00:00:00Z',
      ...extra,
    },
    { headers, status },
  );

describe('workspace', () => {
  it('sends X-Workspace-Id on every request', async () => {
    const { fetch, requests } = mockFetch(() => json(envelope({ id: 'u' })));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, workspaceId: 'ws_1' });

    await lobehub.users.me();
    await lobehub.agents.create({ body: { title: 't' } });

    expect(requests.map((request) => request.headers.get('x-workspace-id'))).toEqual([
      'ws_1',
      'ws_1',
    ]);
  });

  it('lets a call override the workspace with its own header', async () => {
    const { fetch, requests } = mockFetch(() => json(envelope({})));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, workspaceId: 'ws_1' });

    await lobehub.agents.list({ headers: { 'X-Workspace-Id': 'ws_2' } });

    expect(requests[0].headers.get('x-workspace-id')).toBe('ws_2');
  });

  it('sends no workspace header by default', async () => {
    const { fetch, requests } = mockFetch(() => json(envelope({})));
    await createLobeHub({ apiKey: 'sk-lh-test', fetch }).agents.list();
    expect(requests[0].headers.has('x-workspace-id')).toBe(false);
  });
});

describe('idempotencyKey', () => {
  it('is sent as the Idempotency-Key header', async () => {
    const { fetch, requests } = mockFetch(() => json(envelope({})));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await lobehub.agents.create({ body: { title: 't' }, idempotencyKey: 'create-agent-1' });

    expect(requests[0].headers.get('idempotency-key')).toBe('create-agent-1');
  });

  it('makes a POST retryable', async () => {
    let calls = 0;
    const { fetch, requests } = mockFetch(() =>
      ++calls === 1
        ? apiError(503, 'service_unavailable', {}, { 'Retry-After': '0' })
        : json(envelope({ id: 'agt_1' })),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const keyed = await lobehub.agents.create({ body: { title: 't' }, idempotencyKey: 'k1' });

    expect(keyed.error).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(await requests[1].json()).toEqual({ title: 't' });
  });

  it('waits out a 409 idempotency_conflict while the first attempt is still running', async () => {
    let calls = 0;
    const { fetch, requests } = mockFetch(() =>
      ++calls === 1
        ? apiError(409, 'idempotency_conflict', {}, { 'Retry-After': '0' })
        : json(envelope({ id: 'agt_1' }), { headers: { 'Idempotent-Replayed': 'true' } }),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const { data, error } = await lobehub.agents.create({
      body: { title: 't' },
      idempotencyKey: 'k1',
    });

    expect(error).toBeUndefined();
    expect(data?.data.id).toBe('agt_1');
    expect(requests).toHaveLength(2);
  });

  it('does not retry other 409s or a key reused for a different request (422)', async () => {
    for (const [status, code] of [
      [409, 'conflict'],
      [422, 'idempotency_conflict'],
    ] as const) {
      const { fetch, requests } = mockFetch(() => apiError(status, code));
      const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

      const { error } = await lobehub.agents.create({ body: { title: 't' }, idempotencyKey: 'k' });

      expect(error).toMatchObject({ code, status });
      expect(requests).toHaveLength(1);
    }
  });

  it('does not make a keyed PATCH retryable: the server only deduplicates POST', async () => {
    const { fetch, requests } = mockFetch(() => apiError(503, 'service_unavailable'));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await lobehub.agents.update({
      body: { title: 't' },
      idempotencyKey: 'k',
      path: { id: 'agt_1' },
    });

    expect(requests).toHaveLength(1);
  });

  it('never retries a POST without one', async () => {
    const { fetch, requests } = mockFetch(() => apiError(503, 'service_unavailable'));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const { error } = await lobehub.agents.create({ body: { title: 't' } });

    expect(requests).toHaveLength(1);
    expect(error).toBeInstanceOf(LobeHubAPIError);
  });
});

describe('typed errors', () => {
  it('returns LobeHubAPIError with status, code, requestId and details', async () => {
    const details = [{ message: 'Required', path: 'json.title' }];
    const { fetch } = mockFetch(() => apiError(400, 'validation_error', { details }));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const { error } = await lobehub.agents.create({ body: { title: '' } });

    expect(error).toBeInstanceOf(LobeHubAPIError);
    const apiErr = error as unknown as LobeHubAPIError;
    expect(apiErr).toMatchObject({
      code: 'validation_error',
      details,
      message: 'boom',
      requestId: 'req_123',
      status: 400,
    });
    // Still reads like the plain ApiError body it replaced.
    expect(error?.success).toBe(false);
  });

  it('falls back to the X-Request-Id header and the HTTP status', async () => {
    const { fetch } = mockFetch(
      () => new Response('Bad gateway', { headers: { 'X-Request-Id': 'req_hdr' }, status: 502 }),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, maxRetries: 0 });

    const { error } = await lobehub.agents.list();

    expect(error).toMatchObject({ code: 'http_502', requestId: 'req_hdr', status: 502 });
    expect((error as unknown as Error).message).toBe('Bad gateway');
  });

  it('reads the OpenResponses error body of POST /responses', async () => {
    const { fetch } = mockFetch(() =>
      json(
        { error: { code: null, message: 'model is required', type: 'invalid_request_error' } },
        { status: 400 },
      ),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const { error } = await lobehub.responses.create({ body: { input: 'hi', model: '' } });

    expect(error).toMatchObject({
      code: 'invalid_request_error',
      message: 'model is required',
      status: 400,
    });
  });

  it('throws instead of returning with throwOnError, and types data as present', async () => {
    const { fetch } = mockFetch((request) =>
      request.url.endsWith('/agents')
        ? json(envelope({ agents: [{ id: 'agt_1' }], hasMore: false, nextCursor: null, total: 1 }))
        : apiError(404, 'not_found'),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, throwOnError: true });

    const { data } = await lobehub.agents.list();
    expectTypeOf(data.data.agents).toEqualTypeOf<Agent[]>();
    expect(data.data.agents[0].id).toBe('agt_1');

    await expect(lobehub.agents.get({ path: { id: 'missing' } })).rejects.toMatchObject({
      code: 'not_found',
      name: 'LobeHubAPIError',
      status: 404,
    });
  });

  it('throws per call with throwOnError: true', async () => {
    const { fetch } = mockFetch(() => apiError(403, 'workspace_mismatch'));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await expect(lobehub.users.me({ throwOnError: true })).rejects.toBeInstanceOf(LobeHubAPIError);
  });

  it('reports a network failure as LobeHubConnectionError', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, maxRetries: 0 });

    const { error } = await lobehub.agents.list();

    expect(error).toBeInstanceOf(LobeHubConnectionError);
    expect((error as unknown as Error).message).toBe('fetch failed');
  });
});

describe('paginate', () => {
  it('follows nextCursor across pages and yields every item', async () => {
    const pages: Record<string, unknown> = {
      '': { agents: [{ id: 'a1' }, { id: 'a2' }], hasMore: true, nextCursor: 'c2', total: 3 },
      'c2': { agents: [{ id: 'a3' }], hasMore: false, nextCursor: null, total: 3 },
    };
    const { fetch, requests } = mockFetch((request) =>
      json(envelope(pages[new URL(request.url).searchParams.get('cursor') ?? ''])),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const ids: string[] = [];
    // Passed unbound on purpose: paginate carries the client itself.
    for await (const agent of lobehub.paginate(lobehub.agents.list, { query: { limit: 2 } })) {
      expectTypeOf(agent).toEqualTypeOf<Agent>();
      ids.push(agent.id);
    }

    expect(ids).toEqual(['a1', 'a2', 'a3']);
    expect(requests.map((request) => new URL(request.url).search)).toEqual([
      '?limit=2',
      '?limit=2&cursor=c2',
    ]);
  });

  it('reads the generic `items` array of newer endpoints', async () => {
    const { fetch } = mockFetch(() =>
      json(envelope({ hasMore: false, items: [{ id: 'g1' }], nextCursor: null })),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const items: unknown[] = [];
    for await (const goal of lobehub.paginate(lobehub.goals.list)) items.push(goal);

    expect(items).toEqual([{ id: 'g1' }]);
  });

  it('paginates when the client is configured for data-only results', async () => {
    const { fetch } = mockFetch(() =>
      json(envelope({ agents: [{ id: 'a1' }], hasMore: false, nextCursor: null, total: 1 })),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, responseStyle: 'data' });

    const ids: string[] = [];
    for await (const agent of lobehub.paginate(lobehub.agents.list)) ids.push(agent.id);

    expect(ids).toEqual(['a1']);
  });

  it('stops when hasMore is true but no cursor comes back', async () => {
    const { fetch, requests } = mockFetch(() =>
      json(envelope({ hasMore: true, nextCursor: null, topics: [{ id: 't1' }], total: 9 })),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const items: unknown[] = [];
    for await (const topic of lobehub.paginate(lobehub.topics.list)) items.push(topic);

    expect(items).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('rejects with LobeHubAPIError when a page fails', async () => {
    const { fetch } = mockFetch(() => apiError(403, 'forbidden'));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const iterate = async () => {
      for await (const _ of lobehub.paginate(lobehub.agents.list)) {
        // never reached
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
});

const sse = (events: Array<Record<string, unknown>>) =>
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

const RESPONSE = { id: 'resp_1', object: 'response', output_text: 'Hello', status: 'completed' };

describe('responses.stream', () => {
  const streamFetch = () =>
    mockFetch(() => {
      const body = sse([
        {
          response: { ...RESPONSE, status: 'in_progress' },
          sequence_number: 0,
          type: 'response.created',
        },
        {
          content_index: 0,
          delta: 'Hel',
          item_id: 'm',
          logprobs: [],
          output_index: 0,
          sequence_number: 1,
          type: 'response.output_text.delta',
        },
        {
          content_index: 0,
          delta: 'lo',
          item_id: 'm',
          logprobs: [],
          output_index: 0,
          sequence_number: 2,
          type: 'response.output_text.delta',
        },
        { response: RESPONSE, sequence_number: 3, type: 'response.completed' },
      ]);
      // Split mid-event to exercise chunk reassembly.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(body.slice(0, 37)));
          controller.enqueue(encoder.encode(body.slice(37)));
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    });

  it('yields typed events and sends stream: true', async () => {
    const { fetch, requests } = streamFetch();
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    let text = '';
    const types: string[] = [];
    for await (const event of lobehub.responses.stream({ input: 'hi', model: 'agt_1' })) {
      expectTypeOf(event).toEqualTypeOf<ResponseStreamEvent>();
      types.push(event.type);
      if (event.type === 'response.output_text.delta') text += event.delta;
    }

    expect(text).toBe('Hello');
    expect(types).toEqual([
      'response.created',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.completed',
    ]);
    expect(await requests[0].json()).toEqual({ input: 'hi', model: 'agt_1', stream: true });
  });

  it('streams when the client is configured for data-only results', async () => {
    const { fetch } = streamFetch();
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, responseStyle: 'data' });

    let text = '';
    for await (const event of lobehub.responses.stream({ input: 'hi', model: 'agt_1' })) {
      if (event.type === 'response.output_text.delta') text += event.delta;
    }

    expect(text).toBe('Hello');
  });

  it('resolves finalResponse() with the terminal event response', async () => {
    const { fetch } = streamFetch();
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const final = await lobehub.responses.stream({ input: 'hi', model: 'agt_1' }).finalResponse();

    expect(final).toMatchObject({ output_text: 'Hello', status: 'completed' });
  });

  it('rejects with LobeHubAPIError before the stream starts', async () => {
    const { fetch } = mockFetch(() =>
      json({ error: { message: 'no access', type: 'invalid_request_error' } }, { status: 403 }),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await expect(
      lobehub.responses.stream({ input: 'hi', model: 'agt_1' }).finalResponse(),
    ).rejects.toMatchObject({ name: 'LobeHubAPIError', status: 403 });
  });
});

describe('files.upload', () => {
  const uploaded = () => mockFetch(() => json(envelope({ file: { id: 'file_1', name: 'x' } })));

  const sentFile = async (request: Request) => (await request.formData()).get('file') as File;

  it('uploads raw bytes (Buffer / Uint8Array) with a name and the other fields', async () => {
    const { fetch, requests } = uploaded();
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const { data } = await lobehub.files.upload(Buffer.from('hello'), {
      knowledgeBaseId: 'kb_1',
      name: 'hello.txt',
      type: 'text/plain',
    });

    expect(data?.data.file.id).toBe('file_1');
    const form = await requests[0].formData();
    const file = form.get('file') as File;
    expect(file.name).toBe('hello.txt');
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe('hello');
    expect(form.get('knowledgeBaseId')).toBe('kb_1');
  });

  it('uploads a File as-is and a Blob under a default name', async () => {
    const { fetch, requests } = uploaded();
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await lobehub.files.upload(new File(['a'], 'a.md', { type: 'text/markdown' }));
    await lobehub.files.upload(new Blob(['b'], { type: 'text/plain' }));

    expect((await sentFile(requests[0])).name).toBe('a.md');
    expect((await sentFile(requests[1])).name).toBe('file');
  });

  it('reads a local path and names the file after it', async () => {
    const { fetch, requests } = uploaded();
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await lobehub.files.upload(new URL('../package.json', import.meta.url).pathname);

    const file = await sentFile(requests[0]);
    expect(file.name).toBe('package.json');
    expect(JSON.parse(await file.text()).name).toBe('@lobehub/sdk');
  });

  it('throws with throwOnError like any other method', async () => {
    const { fetch } = mockFetch(() => apiError(413, 'payload_too_large'));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, throwOnError: true });

    await expect(lobehub.files.upload(new Uint8Array([1]))).rejects.toMatchObject({
      status: 413,
    });
  });
});
