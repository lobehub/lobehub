// @vitest-environment node
import type { LlmExecuteData } from '@lobechat/agent-gateway-client';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { llmRelayChunks } from '@/server/router-hono/agent/handlers/llmRelay';

import { initModelRuntimeForRequest } from '../oneShot';
import { LLM_RELAY_LEASE_HEADER } from '../protocol';
import {
  readLlmRelayRequest,
  runRouteWithLlmRelayRequest,
  runWithLlmRelayRequest,
} from '../requestScope';
import { FakeRedis } from './fakeRedis';

let redis: FakeRedis | null;
let streamManager: any;

const resolveProviderRelay = vi.hoisted(() => vi.fn());
const initModelRuntimeFromDB = vi.hoisted(() => vi.fn(async () => ({ server: true })));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redis,
}));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => streamManager,
}));
vi.mock('../resolveLlmExecutionSite', () => ({ resolveProviderRelay }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB }));

const USER_ID = 'user-1';
const CHANNEL = 'llmcall:user-1:0b7c1d2e-aaaa-bbbb-cccc-123456789abc';
const REQUEST = { channel: CHANNEL, clientId: 'tab-a' };

const createGatewayStreamManager = () => {
  const executes: LlmExecuteData[] = [];
  return {
    closeLlmCall: vi.fn(async () => {}),
    closeLlmRelayChannel: vi.fn(async () => {}),
    executes,
    openLlmRelayChannel: vi.fn(async () => {}),
    publishStreamEvent: vi.fn(async () => 'id'),
    sendLlmCancel: vi.fn(async () => {}),
    sendLlmExecute: vi.fn(async (_operationId: string, data: LlmExecuteData) => {
      executes.push(data);
      return { delivered: 1, routed: true };
    }),
  };
};

const upload = (execute: LlmExecuteData, body: unknown) =>
  llmRelayChunks({
    json: (value: unknown, status = 200) => Response.json(value, { status }),
    req: {
      header: (name: string) => (name === LLM_RELAY_LEASE_HEADER ? execute.leaseToken : undefined),
      param: (name: string) => (name === 'callId' ? execute.callId : undefined),
      raw: new Request('http://localhost/chunks', { body: JSON.stringify(body), method: 'POST' }),
    },
  } as any);

/** Play the device: answer the n-th dispatched call with its return value. */
const answer = async (index: number, data: unknown) => {
  await vi.waitFor(() => expect(streamManager.executes.length).toBeGreaterThan(index));
  const execute = streamManager.executes[index];
  await upload(execute, {
    chunks: [{ data: JSON.stringify(data), type: 'result_part' }],
    clientId: 'tab-a',
    final: { reason: 'done' },
    seq: 1,
  });
  return execute as LlmExecuteData;
};

const generate = (runtime: Awaited<ReturnType<typeof initModelRuntimeForRequest>>) =>
  runtime.generateObject({ messages: [{ content: 'hi', role: 'user' }], model: 'qwen3:1.7b' });

describe('one-shot relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('KEY_VAULTS_SECRET', 'test-secret');
    redis = new FakeRedis();
    streamManager = createGatewayStreamManager();
    resolveProviderRelay.mockResolvedValue({ runtimeProvider: 'ollama' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('readLlmRelayRequest', () => {
    it('reads the channel and client id headers', () => {
      const headers = new Headers({
        'x-lobe-client-id': 'tab-a',
        'x-lobe-llm-relay-channel': CHANNEL,
      });
      expect(readLlmRelayRequest(headers)).toEqual(REQUEST);
    });

    it('ignores a request missing either header', () => {
      expect(readLlmRelayRequest(new Headers({ 'x-lobe-client-id': 'tab-a' }))).toBeUndefined();
      expect(
        readLlmRelayRequest(new Headers({ 'x-lobe-llm-relay-channel': CHANNEL })),
      ).toBeUndefined();
    });
  });

  it('keeps a provider the server can reach on the server', async () => {
    resolveProviderRelay.mockResolvedValue(undefined);

    const runtime = await runWithLlmRelayRequest(REQUEST, USER_ID, () =>
      initModelRuntimeForRequest({} as any, USER_ID, 'openai', { workspaceId: 'ws-1' }),
    );

    expect(runtime).toEqual({ server: true });
    expect(initModelRuntimeFromDB).toHaveBeenCalledWith({}, USER_ID, 'openai', 'ws-1');
    expect(streamManager.openLlmRelayChannel).not.toHaveBeenCalled();
  });

  it('fails at once with no_executor when no tab is attached to the request (bot, workflow)', async () => {
    await expect(initModelRuntimeForRequest({} as any, USER_ID, 'ollama')).rejects.toMatchObject({
      error: { context: 'no_client_request', reason: 'no_executor' },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      provider: 'ollama',
    });
    expect(streamManager.sendLlmExecute).not.toHaveBeenCalled();
  });

  it("never opens a channel the caller does not own (another user's or a run's operation)", async () => {
    for (const channel of ['llmcall:user-2:0b7c1d2e-aaaa', 'op_123', 'llmcall:user-1:x']) {
      await expect(
        runWithLlmRelayRequest({ channel, clientId: 'tab-a' }, USER_ID, () =>
          initModelRuntimeForRequest({} as any, USER_ID, 'ollama'),
        ),
      ).rejects.toMatchObject({ error: { reason: 'no_executor' } });
    }
    expect(streamManager.openLlmRelayChannel).not.toHaveBeenCalled();
  });

  it('relays every call of the request on its channel, then closes it', async () => {
    const results = await runWithLlmRelayRequest(REQUEST, USER_ID, async () => {
      const runtime = await initModelRuntimeForRequest({} as any, USER_ID, 'ollama');
      const first = generate(runtime);
      const firstExecute = await answer(0, { title: 'One' });
      const second = generate(runtime);
      const secondExecute = await answer(1, { title: 'Two' });
      return {
        executes: [firstExecute, secondExecute],
        values: await Promise.all([first, second]),
      };
    });

    expect(results.values).toEqual([{ title: 'One' }, { title: 'Two' }]);
    expect(results.executes.map((e) => e.callId)).toEqual([`${CHANNEL}:1`, `${CHANNEL}:2`]);
    expect(results.executes[0]).toMatchObject({
      method: 'generateObject',
      operationId: CHANNEL,
      preferredClientId: 'tab-a',
      provider: 'ollama',
      runtimeProvider: 'ollama',
    });
    expect(streamManager.openLlmRelayChannel).toHaveBeenCalledTimes(1);
    expect(streamManager.openLlmRelayChannel).toHaveBeenCalledWith(CHANNEL, USER_ID);
    await vi.waitFor(() =>
      expect(streamManager.closeLlmRelayChannel).toHaveBeenCalledWith(CHANNEL),
    );
  });

  it('treats a call made after the request ended (deferred work) as having no tab', async () => {
    const runtime = await runWithLlmRelayRequest(REQUEST, USER_ID, () =>
      initModelRuntimeForRequest({} as any, USER_ID, 'ollama'),
    );

    await expect(generate(runtime)).rejects.toMatchObject({
      error: { reason: 'no_executor' },
    });
    expect(streamManager.sendLlmExecute).not.toHaveBeenCalled();
  });

  // A deployment that cannot relay (no Agent Gateway, no Redis) keeps the
  // legacy path: the browser sends no relay headers there, and the server
  // calls the provider itself, as before the relay — tab or no tab.
  it('keeps the server runtime on a deployment without a gateway or Redis', async () => {
    streamManager = { publishStreamEvent: vi.fn() };
    await expect(
      runWithLlmRelayRequest(REQUEST, USER_ID, () =>
        initModelRuntimeForRequest({} as any, USER_ID, 'ollama'),
      ),
    ).resolves.toEqual({ server: true });
    // No tab attached (bot, workflow): still the server runtime, not no_executor.
    await expect(initModelRuntimeForRequest({} as any, USER_ID, 'ollama')).resolves.toEqual({
      server: true,
    });

    streamManager = createGatewayStreamManager();
    redis = null;
    await expect(initModelRuntimeForRequest({} as any, USER_ID, 'ollama')).resolves.toEqual({
      server: true,
    });
    expect(initModelRuntimeFromDB).toHaveBeenCalledTimes(3);
    expect(streamManager.sendLlmExecute).not.toHaveBeenCalled();
  });

  it('fails as relay_unsupported when the gateway does not open the channel', async () => {
    streamManager.openLlmRelayChannel.mockRejectedValue(new Error('500'));

    await expect(
      runWithLlmRelayRequest(REQUEST, USER_ID, async () =>
        generate(await initModelRuntimeForRequest({} as any, USER_ID, 'ollama')),
      ),
    ).rejects.toMatchObject({ error: { reason: 'relay_unsupported' } });
    expect(streamManager.sendLlmExecute).not.toHaveBeenCalled();
  });

  it('keeps a streaming route channel open until its body is read', async () => {
    const req = new Request('http://localhost/webapi/chat/ollama', {
      headers: { 'x-lobe-client-id': 'tab-a', 'x-lobe-llm-relay-channel': CHANNEL },
      method: 'POST',
    });

    const response = await runRouteWithLlmRelayRequest(req, USER_ID, async () => {
      const runtime = await initModelRuntimeForRequest({} as any, USER_ID, 'ollama');
      const value = generate(runtime);
      await answer(0, 'done');
      return new Response(JSON.stringify(await value), { status: 201 });
    });

    expect(response.status).toBe(201);
    expect(streamManager.closeLlmRelayChannel).not.toHaveBeenCalled();
    expect(await response.text()).toBe('"done"');
    await vi.waitFor(() => expect(streamManager.closeLlmRelayChannel).toHaveBeenCalledTimes(1));
  });
});
