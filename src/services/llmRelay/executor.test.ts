import type { LlmExecuteData, LlmRelayBatch } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LLM_RELAY_FLUSH_BYTES,
  LLM_RELAY_HEARTBEAT_MS,
  LLM_RELAY_REQUEST_TIMEOUT_MS,
  RelayBatchUploader,
} from './batchUploader';
import type { RelayRuntime } from './executor';
import { LlmRelayExecutor, NON_PREFERRED_CLAIM_DELAY_MS } from './executor';

const PAYLOAD = { messages: [{ content: 'hi', role: 'user' }], model: 'qwen3', stream: true };

const callData = (overrides: Partial<LlmExecuteData> = {}): LlmExecuteData => ({
  assistantMessageId: 'msg-1',
  attempt: 1,
  callId: 'op-1:0:1',
  deadlines: { claimMs: 15_000, firstChunkMs: 120_000, idleMs: 60_000, totalMs: 540_000 },
  leaseToken: 'lease-1',
  model: 'qwen3',
  operationId: 'op-1',
  preferredClientId: 'tab-1',
  provider: 'ollama',
  runtimeProvider: 'ollama',
  stepIndex: 0,
  ...overrides,
});

/** Fake relay endpoints: records every batch, answers like the server would. */
const createServer = (
  answer: (batch: LlmRelayBatch) => { body?: unknown; status: number } = () => ({ status: 200 }),
) => {
  const batches: LlmRelayBatch[] = [];
  const payloadRequests: RequestInit[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/payload')) {
      payloadRequests.push(init);
      return new Response(JSON.stringify(PAYLOAD), { status: 200 });
    }
    const batch = JSON.parse(init.body as string) as LlmRelayBatch;
    batches.push(batch);
    const { body, status } = answer(batch);
    return new Response(JSON.stringify(body ?? { ackSeq: batch.seq }), { status });
  });
  return { batches, fetch: fetchMock as unknown as typeof fetch, payloadRequests };
};

/** A model whose SSE output the test pushes chunk by chunk. */
const createModel = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const calls: Array<{ payload: unknown; signal?: AbortSignal }> = [];
  const runtime: RelayRuntime = {
    chat: vi.fn(async (payload, { signal }) => {
      calls.push({ payload, signal });
      signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      return new Response(body);
    }),
  };
  return {
    calls,
    close: () => controller.close(),
    emit: (type: string, data: unknown) =>
      controller.enqueue(
        encoder.encode(`id: chat_1\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
      ),
    runtime,
  };
};

const waitFor = async (predicate: () => boolean) => {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 3000 });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('LlmRelayExecutor', () => {
  it('claims the call, runs the model locally and uploads its chunks in order', async () => {
    const server = createServer();
    const model = createModel();
    const createRuntime = vi.fn(async () => model.runtime);
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime,
      fetch: server.fetch,
    });
    const output: unknown[] = [];

    const done = executor.execute(callData(), { onOutput: (chunk) => output.push(chunk) });

    await waitFor(() => model.calls.length === 1);
    // The empty claim batch goes out before the model is called.
    expect(server.batches[0]).toEqual({ chunks: [], clientId: 'tab-1', seq: 1 });
    expect(executor.ownsCall('op-1:0:1')).toBe(true);
    expect(new Headers(server.payloadRequests[0].headers).get('x-llm-relay-lease')).toBe('lease-1');
    expect(createRuntime).toHaveBeenCalledWith({
      payload: PAYLOAD,
      provider: 'ollama',
      runtimeProvider: 'ollama',
    });
    expect(model.calls[0].payload).toEqual(PAYLOAD);

    model.emit('text', 'Hello');
    model.emit('text', ' world');
    model.emit('usage', { totalTokens: 7 });
    model.close();
    await done;

    const uploaded = server.batches.flatMap((batch) => batch.chunks);
    expect(uploaded).toEqual([
      { data: 'Hello', id: 'chat_1', type: 'text' },
      { data: ' world', id: 'chat_1', type: 'text' },
      { data: { totalTokens: 7 }, id: 'chat_1', type: 'usage' },
    ]);
    expect(server.batches.map((batch) => batch.seq)).toEqual(
      server.batches.map((_, index) => index + 1),
    );
    expect(server.batches.at(-1)?.final).toEqual({ reason: 'done' });
    expect(output).toEqual(uploaded);
  });

  it('stops without calling the model when another client already claimed the call', async () => {
    const server = createServer(() => ({ body: { cancel: true }, status: 409 }));
    const createRuntime = vi.fn();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime,
      fetch: server.fetch,
    });

    await executor.execute(callData());

    expect(createRuntime).not.toHaveBeenCalled();
    expect(server.batches).toHaveLength(1);
    expect(executor.ownsCall('op-1:0:1')).toBe(false);
  });

  it('aborts the local model request on llm_cancel and reports the attempt aborted', async () => {
    const server = createServer();
    const model = createModel();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime: async () => model.runtime,
      fetch: server.fetch,
    });

    const done = executor.execute(callData());
    await waitFor(() => model.calls.length === 1);
    model.emit('text', 'partial');

    executor.cancel({ callId: 'op-1:0:1', reason: 'interrupted' });
    await done;

    expect(model.calls[0].signal?.aborted).toBe(true);
    expect(server.batches.at(-1)?.final).toEqual({ reason: 'aborted' });
    expect(executor.isRunning('op-1:0:1')).toBe(false);
  });

  it('drops the attempt silently when its run ends before llm_cancel arrives', async () => {
    const server = createServer();
    const model = createModel();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime: async () => model.runtime,
      fetch: server.fetch,
    });

    const done = executor.execute(callData());
    await waitFor(() => model.calls.length === 1);
    model.emit('text', 'partial');

    executor.cancelOperation('other-op');
    expect(executor.isRunning('op-1:0:1')).toBe(true);

    executor.cancelOperation('op-1');
    await done;

    expect(model.calls[0].signal?.aborted).toBe(true);
    // The server already settled the step: no `aborted` batch that could read
    // as a lost executor and trigger a re-dispatch.
    expect(server.batches.some((batch) => batch.final)).toBe(false);
  });

  it('stops as soon as an upload ack says the server no longer wants the attempt', async () => {
    const server = createServer((batch) =>
      batch.chunks.length > 0
        ? { body: { ackSeq: batch.seq, cancel: true }, status: 200 }
        : { status: 200 },
    );
    const model = createModel();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime: async () => model.runtime,
      fetch: server.fetch,
    });

    const done = executor.execute(callData());
    await waitFor(() => model.calls.length === 1);
    model.emit('text', 'one');
    await done;

    expect(model.calls[0].signal?.aborted).toBe(true);
    // Nothing is uploaded after the refusal, not even a final batch.
    expect(server.batches.some((batch) => batch.final)).toBe(false);
  });

  it('uploads the provider error as the final batch so the server classifies it', async () => {
    const server = createServer();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime: async () => ({
        chat: async () => {
          throw {
            error: new TypeError('Failed to fetch'),
            errorType: 'OllamaServiceUnavailable',
            provider: 'ollama',
          };
        },
      }),
      fetch: server.fetch,
    });

    await executor.execute(callData());

    expect(server.batches.at(-1)?.final).toEqual({
      error: {
        error: { message: 'Failed to fetch', name: 'TypeError' },
        errorType: 'OllamaServiceUnavailable',
        provider: 'ollama',
      },
      reason: 'error',
    });
  });

  it('runs a replayed llm_execute for the same call only once', async () => {
    const server = createServer();
    const model = createModel();
    const createRuntime = vi.fn(async () => model.runtime);
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime,
      fetch: server.fetch,
    });

    const first = executor.execute(callData());
    const replay = executor.execute(callData());
    await waitFor(() => model.calls.length === 1);
    model.close();
    await Promise.all([first, replay]);
    await executor.execute(callData());

    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it('settles a call cancelled while its claim is stalled', async () => {
    const stalled = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const createRuntime = vi.fn();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime,
      fetch: stalled,
    });

    const done = executor.execute(callData());
    await vi.waitFor(() => expect(stalled).toHaveBeenCalled());
    executor.cancel({ callId: 'op-1:0:1', reason: 'interrupted' });
    await done;

    expect(createRuntime).not.toHaveBeenCalled();
    expect(executor.isRunning('op-1:0:1')).toBe(false);
  });

  it('lets the client that started the run claim first', async () => {
    vi.useFakeTimers();
    const server = createServer(() => ({ body: { cancel: true }, status: 409 }));
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-2',
      createRuntime: vi.fn(),
      fetch: server.fetch,
    });

    const done = executor.execute(callData({ preferredClientId: 'tab-1' }));
    await vi.advanceTimersByTimeAsync(NON_PREFERRED_CLAIM_DELAY_MS - 1);
    expect(server.batches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(server.batches).toHaveLength(1);
  });
});

describe('LlmRelayExecutor non-chat methods (one-shot relay)', () => {
  const run = async (data: LlmExecuteData, runtime: RelayRuntime) => {
    const server = createServer();
    const executor = new LlmRelayExecutor({
      clientId: () => 'tab-1',
      createRuntime: async () => runtime,
      fetch: server.fetch,
    });
    await executor.execute(data);
    return server;
  };

  const resultOf = (batches: LlmRelayBatch[]) =>
    JSON.parse(
      batches
        .flatMap((batch) => batch.chunks)
        .filter((chunk) => chunk.type === 'result_part')
        .map((chunk) => chunk.data)
        .join(''),
    );

  it('runs generateObject and uploads its value as JSON parts', async () => {
    const generateObject = vi.fn(async () => ({ title: 'Hello' }));
    const server = await run(callData({ method: 'generateObject' }), {
      chat: vi.fn(),
      generateObject,
    });

    expect(generateObject).toHaveBeenCalledWith(PAYLOAD, expect.anything());
    expect(resultOf(server.batches)).toEqual({ title: 'Hello' });
    expect(server.batches.at(-1)?.final).toEqual({ reason: 'done' });
  });

  // The server reads "no result parts" as `undefined` — what a provider returns
  // for absent structured output — and must not get `null` instead.
  it('uploads no result for an undefined value', async () => {
    const server = await run(callData({ method: 'generateObject' }), {
      chat: vi.fn(),
      generateObject: vi.fn(async () => undefined),
    });

    const parts = server.batches
      .flatMap((batch) => batch.chunks)
      .filter((chunk) => chunk.type === 'result_part');
    expect(parts).toEqual([]);
    expect(server.batches.at(-1)?.final).toEqual({ reason: 'done' });
  });

  it('splits a large model list across batches under the size cap', async () => {
    const list = Array.from({ length: 3000 }, (_, i) => ({ id: `model-${i}`, displayName: 'x' }));
    const server = await run(callData({ method: 'models' }), {
      chat: vi.fn(),
      models: vi.fn(async () => list),
    });

    expect(resultOf(server.batches)).toEqual(list);
    for (const batch of server.batches)
      expect(JSON.stringify(batch).length).toBeLessThan(256 * 1024);
  });

  it('streams pullModel progress text', async () => {
    const progress = '{"status":"pulling","completed":1,"total":2}\n{"status":"success"}\n';
    const server = await run(callData({ method: 'pullModel' }), {
      chat: vi.fn(),
      pullModel: vi.fn(async () => new Response(progress)),
    });

    const text = server.batches
      .flatMap((batch) => batch.chunks)
      .filter((chunk) => chunk.type === 'progress')
      .map((chunk) => chunk.data)
      .join('');
    expect(text).toBe(progress);
    expect(server.batches.at(-1)?.final).toEqual({ reason: 'done' });
  });

  it('reports a failed method as the final error', async () => {
    const server = await run(callData({ method: 'generateObject' }), {
      chat: vi.fn(),
      generateObject: vi.fn(async () => {
        throw { error: { message: 'model not found' }, errorType: 'OllamaBizError' };
      }),
    });

    expect(server.batches.at(-1)?.final).toMatchObject({
      error: { errorType: 'OllamaBizError', provider: 'ollama' },
      reason: 'error',
    });
  });
});

describe('RelayBatchUploader', () => {
  it('sends an empty heartbeat batch while the model produces nothing', async () => {
    vi.useFakeTimers();
    const server = createServer();
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: server.fetch,
      leaseToken: 'l',
      onRejected: vi.fn(),
    });

    await uploader.claim();
    expect(server.batches).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(LLM_RELAY_HEARTBEAT_MS + LLM_RELAY_HEARTBEAT_MS / 2);
    expect(server.batches.length).toBeGreaterThanOrEqual(2);
    expect(server.batches[1]).toEqual({ chunks: [], clientId: 'tab-1', seq: 2 });
    uploader.dispose();
  });

  it('batches chunks every 200ms and flushes at once past 64KB', async () => {
    vi.useFakeTimers();
    const server = createServer();
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: server.fetch,
      leaseToken: 'l',
      onRejected: vi.fn(),
    });
    await uploader.claim();

    uploader.push({ data: 'a', type: 'text' });
    uploader.push({ data: 'b', type: 'text' });
    await vi.advanceTimersByTimeAsync(199);
    expect(server.batches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.batches[1].chunks).toHaveLength(2);

    uploader.push({ data: 'x'.repeat(LLM_RELAY_FLUSH_BYTES), type: 'text' });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.batches).toHaveLength(3);
    uploader.dispose();
  });

  it('flushes on chunk arrival when its timer is throttled (background tab)', async () => {
    vi.useFakeTimers();
    const server = createServer();
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: server.fetch,
      leaseToken: 'l',
      onRejected: vi.fn(),
    });
    await uploader.claim();

    uploader.push({ data: 'a', type: 'text' });
    // The page clock moves on but the throttled flush timer has not fired.
    vi.setSystemTime(Date.now() + 1000);
    uploader.push({ data: 'b', type: 'text' });
    await Promise.resolve();

    expect(server.batches).toHaveLength(2);
    expect(server.batches[1].chunks.map((c) => c.data)).toEqual(['a', 'b']);
    uploader.dispose();
  });

  it('gives up on a stalled upload instead of waiting on it forever', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    // A server that accepts the request and never answers.
    const stalled = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signals.push(init.signal!);
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const onRejected = vi.fn();
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: stalled,
      leaseToken: 'l',
      onRejected,
    });

    const claimed = uploader.claim();
    await vi.advanceTimersByTimeAsync(LLM_RELAY_REQUEST_TIMEOUT_MS * 3 + 2000);

    expect(await claimed).toBe(false);
    expect(signals).toHaveLength(3);
    expect(onRejected).toHaveBeenCalledWith('unreachable');
  });

  it('aborts the stalled request in flight when disposed', async () => {
    let signal: AbortSignal | undefined;
    const stalled = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init.signal!;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: stalled,
      leaseToken: 'l',
      onRejected: vi.fn(),
    });

    const claimed = uploader.claim();
    await vi.waitFor(() => expect(signal).toBeDefined());
    uploader.dispose();

    expect(signal?.aborted).toBe(true);
    expect(await claimed).toBe(false);
  });

  it('never starts the uploads queued behind a stalled request once disposed', async () => {
    const sent: number[] = [];
    const stalledOnBatch = vi.fn((_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as LlmRelayBatch;
      sent.push(batch.seq);
      if (batch.seq === 1) return Promise.resolve(new Response(JSON.stringify({ ackSeq: 1 })));
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: stalledOnBatch,
      leaseToken: 'l',
      onRejected: vi.fn(),
    });

    expect(await uploader.claim()).toBe(true);
    uploader.push({ data: 'a'.repeat(LLM_RELAY_FLUSH_BYTES), type: 'text' });
    await vi.waitFor(() => expect(sent).toEqual([1, 2]));
    uploader.push({ data: 'b'.repeat(LLM_RELAY_FLUSH_BYTES), type: 'text' });
    uploader.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent).toEqual([1, 2]);
  });

  it('retries a failed upload with the same seq', async () => {
    vi.useFakeTimers();
    let failures = 1;
    const batches: number[] = [];
    const flaky = vi.fn(async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as LlmRelayBatch;
      batches.push(batch.seq);
      if (failures-- > 0) throw new TypeError('network');
      return new Response(JSON.stringify({ ackSeq: batch.seq }));
    }) as unknown as typeof fetch;
    const uploader = new RelayBatchUploader({
      callId: 'c',
      clientId: 'tab-1',
      fetch: flaky,
      leaseToken: 'l',
      onRejected: vi.fn(),
    });

    const claimed = uploader.claim();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await claimed).toBe(true);
    expect(batches).toEqual([1, 1]);
    uploader.dispose();
  });
});
