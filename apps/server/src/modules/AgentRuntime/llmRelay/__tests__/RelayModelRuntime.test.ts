// @vitest-environment node
import type { LlmCancelData, LlmExecuteData } from '@lobechat/agent-gateway-client';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { llmRelayChunks, llmRelayPayload } from '@/server/router-hono/agent/handlers/llmRelay';
import { runWithInvocationDeadline } from '@/server/utils/invocationDeadline';

import {
  LLM_RELAY_INVOCATION_MARGIN_MS,
  LLM_RELAY_LEASE_HEADER,
  llmRelayKeys,
  signLlmRelayLease,
} from '../protocol';
import { RelayModelRuntime } from '../RelayModelRuntime';
import { FakeRedis } from './fakeRedis';

let redis: FakeRedis;

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redis,
}));

const USER_ID = 'user-1';
const CALL_ID = 'op_1:0:g1:1';

const payload = {
  messages: [{ content: 'Say hello', role: 'user' as const }],
  model: 'llama3',
  stream: true,
};

/** The slice of a Hono Context the relay handlers read. */
const buildContext = (
  callId: string,
  { body, lease, request }: { body?: unknown; lease?: string; request?: Request } = {},
) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  return {
    body: (value: string, status: number, headers?: Record<string, string>) =>
      new Response(value, { headers, status }),
    json: (value: unknown, status = 200) => Response.json(value, { status }),
    req: {
      header: (name: string) => (name === LLM_RELAY_LEASE_HEADER ? lease : undefined),
      param: (name: string) => (name === 'callId' ? callId : undefined),
      raw: request ?? new Request('http://localhost/chunks', { body: raw, method: 'POST' }),
    },
  } as any;
};

const createStreamManager = () => {
  const events: { data: any; type: string }[] = [];
  return {
    events,
    manager: {
      publishStreamEvent: vi.fn(async (_operationId: string, event: any) => {
        events.push(event);
        return 'event-id';
      }),
    } as any,
  };
};

const createRuntime = (
  streamManager: any,
  deadlines = { claimMs: 2000, firstChunkMs: 2000, idleMs: 2000, totalMs: 5000 },
) =>
  new RelayModelRuntime({
    assistantMessageId: 'msg_1',
    attempt: 1,
    callId: CALL_ID,
    deadlines,
    operationId: 'op_1',
    preferredClientId: 'tab-a',
    provider: 'ollama',
    redis: redis as any,
    runtimeProvider: 'ollama',
    stepIndex: 0,
    streamManager,
    userId: USER_ID,
  });

/** Wait until the runtime has dispatched `llm_execute`, then return its data. */
const waitForExecute = async (events: { data: any; type: string }[]) => {
  await vi.waitFor(() => expect(events.some((e) => e.type === 'llm_execute')).toBe(true));
  return events.find((e) => e.type === 'llm_execute')!.data as LlmExecuteData;
};

const post = (lease: string, body: unknown, callId = CALL_ID) =>
  llmRelayChunks(buildContext(callId, { body, lease }));

describe('RelayModelRuntime + llm-relay handlers', () => {
  beforeEach(() => {
    vi.stubEnv('KEY_VAULTS_SECRET', 'test-secret');
    redis = new FakeRedis();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('turns uploaded batches back into the server callback pipeline, in seq order and deduped', async () => {
    const { events, manager } = createStreamManager();
    const runtime = createRuntime(manager);
    const onText = vi.fn();
    const onCompletion = vi.fn();

    const done = runtime
      .chat(payload, { callback: { onCompletion, onText } })
      .then((response) => consumeStreamUntilDone(response));

    const execute = await waitForExecute(events);
    expect(execute).toMatchObject({
      assistantMessageId: 'msg_1',
      attempt: 1,
      callId: CALL_ID,
      model: 'llama3',
      operationId: 'op_1',
      preferredClientId: 'tab-a',
      provider: 'ollama',
      runtimeProvider: 'ollama',
    });
    // The event carries no messages; the device fetches the body with its lease.
    expect(JSON.stringify(execute)).not.toContain('Say hello');

    const payloadRes = await llmRelayPayload(buildContext(CALL_ID, { lease: execute.leaseToken }));
    expect(payloadRes.status).toBe(200);
    expect(await payloadRes.json()).toEqual(payload);

    const usage = {
      inputTextTokens: 5,
      outputTextTokens: 2,
      totalInputTokens: 5,
      totalOutputTokens: 2,
      totalTokens: 7,
    };
    // seq 2 arrives before seq 1, and seq 1 is re-sent
    expect(
      (
        await post(execute.leaseToken, {
          chunks: [{ data: ' world', type: 'text' }],
          clientId: 'tab-a',
          seq: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(execute.leaseToken, {
          chunks: [{ data: 'Hello', type: 'text' }],
          clientId: 'tab-a',
          seq: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(execute.leaseToken, {
          chunks: [{ data: 'Hello', type: 'text' }],
          clientId: 'tab-a',
          seq: 1,
        })
      ).status,
    ).toBe(200);
    const last = await post(execute.leaseToken, {
      chunks: [{ data: usage, type: 'usage' }],
      clientId: 'tab-a',
      final: { reason: 'done' },
      seq: 3,
    });
    expect(await last.json()).toEqual({ ackSeq: 3 });

    await done;

    expect(onText.mock.calls.map(([text]) => text)).toEqual(['Hello', ' world']);
    expect(onCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world', usage }),
    );
    expect(runtime.result.usageEstimated).toBe(false);
    // The call is closed: no payload left, late uploads are told to stop.
    expect(redis.peek(llmRelayKeys.payload(CALL_ID))).toBeUndefined();
    const late = await post(execute.leaseToken, { chunks: [], clientId: 'tab-a', seq: 4 });
    expect(late.status).toBe(410);
    expect(await late.json()).toMatchObject({ cancel: true });
  });

  it('estimates usage when the device reports none', async () => {
    const { events, manager } = createStreamManager();
    const runtime = createRuntime(manager);
    const onCompletion = vi.fn();

    const done = runtime
      .chat(payload, { callback: { onCompletion } })
      .then((response) => consumeStreamUntilDone(response));
    const { leaseToken } = await waitForExecute(events);

    await post(leaseToken, {
      chunks: [{ data: 'Hello there, how are you today?', type: 'text' }],
      clientId: 'tab-a',
      final: { reason: 'done' },
      seq: 1,
    });
    await done;

    expect(runtime.result.usageEstimated).toBe(true);
    const { usage } = onCompletion.mock.calls[0][0];
    expect(usage.totalOutputTokens).toBeGreaterThan(0);
    expect(usage.totalInputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.totalInputTokens + usage.totalOutputTokens);
  });

  it('hands a device-side provider error to the pipeline as a stream error', async () => {
    const { events, manager } = createStreamManager();
    const onError = vi.fn();

    const done = createRuntime(manager)
      .chat(payload, { callback: { onError } })
      .then((response) => consumeStreamUntilDone(response));
    const { leaseToken } = await waitForExecute(events);

    const error = { errorType: 'OllamaServiceUnavailable', message: 'connect ECONNREFUSED' };
    await post(leaseToken, {
      chunks: [],
      clientId: 'tab-a',
      final: { error, reason: 'error' },
      seq: 1,
    });
    await done;

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('fails as ClientLlmExecutorUnavailable when nobody claims the call, and cancels it', async () => {
    const { events, manager } = createStreamManager();
    const response = await createRuntime(manager, {
      claimMs: 30,
      firstChunkMs: 1000,
      idleMs: 1000,
      totalMs: 2000,
    }).chat(payload, {});

    await expect(consumeStreamUntilDone(response)).rejects.toMatchObject({
      error: { reason: 'claim_timeout', recoverable: true },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      provider: 'ollama',
    });
    const cancel = events.find((e) => e.type === 'llm_cancel')?.data as LlmCancelData;
    expect(cancel).toEqual({ callId: CALL_ID, reason: 'timeout' });
    expect(redis.peek(llmRelayKeys.cancel(CALL_ID))).toBe('timeout');
  });

  it('fails as ClientLlmExecutorLost when the executor goes silent mid-stream', async () => {
    const { events, manager } = createStreamManager();
    const response = await createRuntime(manager, {
      claimMs: 1000,
      firstChunkMs: 1000,
      idleMs: 40,
      totalMs: 2000,
    }).chat(payload, {});
    const { leaseToken } = await waitForExecute(events);
    await post(leaseToken, { chunks: [{ data: 'Hel', type: 'text' }], clientId: 'tab-a', seq: 1 });

    await expect(consumeStreamUntilDone(response)).rejects.toMatchObject({
      error: { reason: 'idle' },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorLost,
    });
  });

  it('fails as ClientLlmExecutorLost on a batch gap that never fills', async () => {
    const { events, manager } = createStreamManager();
    const response = await createRuntime(manager, {
      claimMs: 1000,
      firstChunkMs: 1000,
      idleMs: 40,
      totalMs: 2000,
    }).chat(payload, {});
    const { leaseToken } = await waitForExecute(events);
    await post(leaseToken, { chunks: [{ data: 'a', type: 'text' }], clientId: 'tab-a', seq: 1 });
    await post(leaseToken, { chunks: [{ data: 'c', type: 'text' }], clientId: 'tab-a', seq: 3 });

    await expect(consumeStreamUntilDone(response)).rejects.toMatchObject({
      error: { reason: 'gap' },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorLost,
    });
  });

  it('fits the attempt into what is left of the invocation', async () => {
    const { events, manager } = createStreamManager();
    const killedAt = Date.now() + 100_000;
    const response = await runWithInvocationDeadline(killedAt, () =>
      createRuntime(manager, {
        claimMs: 1000,
        firstChunkMs: 1000,
        idleMs: 1000,
        totalMs: 540_000,
      }).chat(payload, {}),
    );

    const { deadlines } = await waitForExecute(events);
    // 100s left, minus the cleanup margin: the device is told to stop by then.
    expect(deadlines.totalMs).toBeLessThanOrEqual(100_000 - LLM_RELAY_INVOCATION_MARGIN_MS);
    expect(deadlines.totalMs).toBeGreaterThan(60_000);
    await response.body?.cancel();
  });

  it('fails as ClientLlmTimeout(first_chunk) when only heartbeats arrive', async () => {
    const { events, manager } = createStreamManager();
    const response = await createRuntime(manager, {
      claimMs: 1000,
      firstChunkMs: 40,
      idleMs: 1000,
      totalMs: 2000,
    }).chat(payload, {});
    const { leaseToken } = await waitForExecute(events);
    await post(leaseToken, { chunks: [], clientId: 'tab-a', seq: 1 });

    await expect(consumeStreamUntilDone(response)).rejects.toMatchObject({
      error: { stage: 'first_chunk' },
      errorType: AgentRuntimeErrorType.ClientLlmTimeout,
    });
  });

  it('stops on the step abort signal: aborts, tells the device to cancel, and closes the call', async () => {
    const { events, manager } = createStreamManager();
    const controller = new AbortController();
    const diagnostics: any = {};
    const onText = vi.fn();
    const response = await createRuntime(manager).chat(payload, {
      callback: { onText },
      diagnostics,
      signal: controller.signal,
    });
    const consumed = consumeStreamUntilDone(response);
    const { leaseToken } = await waitForExecute(events);
    await post(leaseToken, {
      chunks: [{ data: 'partial', type: 'text' }],
      clientId: 'tab-a',
      seq: 1,
    });
    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('partial'));

    controller.abort();

    await expect(consumed).rejects.toMatchObject({ name: 'AbortError' });
    expect(diagnostics.providerResponse.aborted).toBe(true);
    expect(events.find((e) => e.type === 'llm_cancel')?.data).toEqual({
      callId: CALL_ID,
      reason: 'interrupted',
    });
    const late = await post(leaseToken, { chunks: [], clientId: 'tab-a', seq: 2 });
    expect(late.status).toBe(410);
  });

  it('treats a client that ends the attempt on its own as a lost executor', async () => {
    const { events, manager } = createStreamManager();
    const response = await createRuntime(manager).chat(payload, {});
    const { leaseToken } = await waitForExecute(events);
    await post(leaseToken, { chunks: [], clientId: 'tab-a', final: { reason: 'aborted' }, seq: 1 });

    await expect(consumeStreamUntilDone(response)).rejects.toMatchObject({
      error: { reason: 'client_aborted' },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorLost,
    });
  });
});

describe('RelayModelRuntime over a gateway with relay routes', () => {
  beforeEach(() => {
    vi.stubEnv('KEY_VAULTS_SECRET', 'test-secret');
    redis = new FakeRedis();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A gateway notifier: `llm_execute` / `llm_cancel` go through their own routes. */
  const createGatewayManager = () => {
    const executes: LlmExecuteData[] = [];
    const manager = {
      closeLlmCall: vi.fn(async () => {}),
      publishStreamEvent: vi.fn(async () => 'event-id'),
      sendLlmCancel: vi.fn(async () => {}),
      sendLlmExecute: vi.fn(async (_operationId: string, data: LlmExecuteData) => {
        executes.push(data);
        return { delivered: 1, routed: true };
      }),
    };
    return { executes, manager };
  };

  it('dispatches through the routed path and closes the call when the attempt is done', async () => {
    const { executes, manager } = createGatewayManager();
    const done = createRuntime(manager)
      .chat(payload, {})
      .then((response) => consumeStreamUntilDone(response));

    await vi.waitFor(() => expect(executes).toHaveLength(1));
    expect(manager.sendLlmExecute).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ callId: CALL_ID, preferredClientId: 'tab-a', stepIndex: 0 }),
    );
    // Nothing goes out as a broadcast stream event.
    expect(manager.publishStreamEvent).not.toHaveBeenCalled();

    await post(executes[0].leaseToken, {
      chunks: [{ data: 'Hi', type: 'text' }],
      clientId: 'tab-a',
      final: { reason: 'done' },
      seq: 1,
    });
    await done;

    expect(manager.closeLlmCall).toHaveBeenCalledWith('op_1', CALL_ID);
    expect(manager.sendLlmCancel).not.toHaveBeenCalled();
  });

  it('settles the stream without waiting on a stalled gateway close', async () => {
    const { executes, manager } = createGatewayManager();
    manager.closeLlmCall.mockImplementation(() => new Promise<void>(() => {}));
    const done = createRuntime(manager)
      .chat(payload, {})
      .then((response) => consumeStreamUntilDone(response));

    await vi.waitFor(() => expect(executes).toHaveLength(1));
    await post(executes[0].leaseToken, {
      chunks: [{ data: 'Hi', type: 'text' }],
      clientId: 'tab-a',
      final: { reason: 'done' },
      seq: 1,
    });

    await expect(done).resolves.toBeUndefined();
    expect(manager.closeLlmCall).toHaveBeenCalledWith('op_1', CALL_ID);
  });

  it('cancels through the routed path on stop, then closes the call', async () => {
    const { executes, manager } = createGatewayManager();
    const controller = new AbortController();
    const response = await createRuntime(manager).chat(payload, { signal: controller.signal });
    const consumed = consumeStreamUntilDone(response);
    await vi.waitFor(() => expect(executes).toHaveLength(1));
    await post(executes[0].leaseToken, { chunks: [], clientId: 'tab-a', seq: 1 });

    controller.abort();

    await expect(consumed).rejects.toMatchObject({ name: 'AbortError' });
    expect(manager.sendLlmCancel).toHaveBeenCalledWith('op_1', {
      callId: CALL_ID,
      reason: 'interrupted',
      stepIndex: 0,
    });
    expect(manager.closeLlmCall).toHaveBeenCalledWith('op_1', CALL_ID);
    expect(manager.publishStreamEvent).not.toHaveBeenCalled();
  });

  it('fails as ClientLlmExecutorUnavailable when the gateway refuses the dispatch', async () => {
    const { manager } = createGatewayManager();
    manager.sendLlmExecute.mockRejectedValueOnce(new Error('Gateway returned 409'));

    await expect(createRuntime(manager).chat(payload, {})).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
    });
    expect(redis.peek(llmRelayKeys.payload(CALL_ID))).toBeUndefined();
  });

  it('fails as not_delivered at once when the gateway reached no client, without waiting out the claim', async () => {
    const { manager } = createGatewayManager();
    manager.sendLlmExecute.mockResolvedValueOnce({ delivered: 0, routed: true });
    // A claim window far longer than the test: only the fast path can settle it.
    const runtime = createRuntime(manager, {
      claimMs: 60_000,
      firstChunkMs: 60_000,
      idleMs: 60_000,
      totalMs: 120_000,
    });

    const startedAt = Date.now();
    await expect(runtime.chat(payload, {})).rejects.toMatchObject({
      error: { reason: 'not_delivered', recoverable: true },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
    });
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(redis.peek(llmRelayKeys.payload(CALL_ID))).toBeUndefined();
    expect(manager.closeLlmCall).toHaveBeenCalledWith('op_1', CALL_ID);
  });

  it('still waits for a claim when the gateway could not count recipients', async () => {
    const { manager } = createGatewayManager();
    // A broadcast fallback (self-hosted gateway) cannot tell who got the call.
    manager.sendLlmExecute.mockResolvedValueOnce({ delivered: undefined, routed: false } as any);

    const response = await createRuntime(manager, {
      claimMs: 200,
      firstChunkMs: 2000,
      idleMs: 2000,
      totalMs: 5000,
    }).chat(payload, {});

    await expect(consumeStreamUntilDone(response)).rejects.toMatchObject({
      error: { reason: 'claim_timeout' },
    });
  });
});

describe('llm-relay upload handler', () => {
  beforeEach(() => {
    vi.stubEnv('KEY_VAULTS_SECRET', 'test-secret');
    redis = new FakeRedis();
    void redis.set(llmRelayKeys.open(CALL_ID), USER_ID, 'PX', 60_000);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const lease = (overrides: Partial<{ callId: string; exp: number; userId: string }> = {}) =>
    signLlmRelayLease({ callId: CALL_ID, exp: Date.now() + 60_000, userId: USER_ID, ...overrides });

  it('rejects a missing, forged, expired or other-call lease with 401', async () => {
    const batch = { chunks: [], clientId: 'tab-a', seq: 1 };
    expect((await post(undefined as any, batch)).status).toBe(401);
    expect((await post(`${lease()}x`, batch)).status).toBe(401);
    expect((await post(lease({ exp: Date.now() - 1 }), batch)).status).toBe(401);
    expect((await post(lease({ callId: 'op_1:0:g1:2' }), batch)).status).toBe(401);
    expect(redis.peekStream(llmRelayKeys.stream(CALL_ID))).toHaveLength(0);
  });

  it("rejects a lease for another user's call with 403", async () => {
    const res = await post(lease({ userId: 'user-2' }), { chunks: [], clientId: 'tab-a', seq: 1 });
    expect(res.status).toBe(403);
  });

  it('lets only the first uploading client write the call (409 for the rest)', async () => {
    expect((await post(lease(), { chunks: [], clientId: 'tab-a', seq: 1 })).status).toBe(200);

    const rival = await post(lease(), {
      chunks: [{ data: 'x', type: 'text' }],
      clientId: 'tab-b',
      seq: 2,
    });
    expect(rival.status).toBe(409);
    expect(await rival.json()).toMatchObject({ cancel: true });
    expect(redis.peekStream(llmRelayKeys.stream(CALL_ID))).toHaveLength(1);
  });

  it('rejects oversized batches with 413 and malformed ones with 400', async () => {
    const big = {
      chunks: [{ data: 'x'.repeat(300 * 1024), type: 'text' }],
      clientId: 'tab-a',
      seq: 1,
    };
    expect((await post(lease(), big)).status).toBe(413);
    expect((await post(lease(), { chunks: 'nope', clientId: 'tab-a', seq: 1 })).status).toBe(400);
    expect((await post(lease(), '{not json')).status).toBe(400);
  });

  /** A body stream of `count` 64 KB parts that records how many parts were read. */
  const trackedRequest = (count: number, headers?: Record<string, string>) => {
    let pulled = 0;
    const part = new TextEncoder().encode('x'.repeat(64 * 1024));
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled >= count) return controller.close();
          pulled += 1;
          controller.enqueue(part);
        },
      },
      // pull only when the handler reads, so `pulled` counts real reads
      { highWaterMark: 0 },
    );
    // undici requires `duplex` for a streamed request body
    const request = new Request('http://localhost/chunks', {
      body,
      duplex: 'half',
      headers,
      method: 'POST',
    } as RequestInit);
    return { pulled: () => pulled, request };
  };

  it('never reads the body of an upload without a valid lease', async () => {
    const { pulled, request } = trackedRequest(64);
    const res = await llmRelayChunks(buildContext(CALL_ID, { lease: 'forged', request }));

    expect(res.status).toBe(401);
    expect(pulled()).toBe(0);
  });

  it('stops reading an oversized batch at the limit instead of buffering it whole', async () => {
    // no content-length: the cap has to hold while streaming
    const streamed = trackedRequest(64);
    const res = await llmRelayChunks(
      buildContext(CALL_ID, { lease: lease(), request: streamed.request }),
    );
    expect(res.status).toBe(413);
    expect(streamed.pulled()).toBeLessThanOrEqual(6);

    // a declared content-length over the cap is refused before any read
    const declared = trackedRequest(64, { 'content-length': String(4 * 1024 * 1024) });
    const declaredRes = await llmRelayChunks(
      buildContext(CALL_ID, { lease: lease(), request: declared.request }),
    );
    expect(declaredRes.status).toBe(413);
    expect(declared.pulled()).toBe(0);
  });

  it('answers cancel: true once the server gave up on the attempt', async () => {
    await redis.set(llmRelayKeys.cancel(CALL_ID), 'interrupted');
    const res = await post(lease(), { chunks: [], clientId: 'tab-a', seq: 1 });
    expect(await res.json()).toEqual({ ackSeq: 1, cancel: true });
  });
});
