// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runWithLlmRelayRequest } from '@/server/modules/AgentRuntime/llmRelay/requestScope';
import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { AiGenerationService } from './index';

const resolveProviderRelay = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay,
}));
// A deployment that can relay (Agent Gateway + Redis); one that cannot keeps
// calling the provider from the server.
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => ({}) }));
vi.mock('@/server/modules/AgentRuntime/factory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStreamEventManager: () => ({ openLlmRelayChannel: vi.fn(), sendLlmExecute: vi.fn() }),
}));

describe('AiGenerationService.generateObject', () => {
  const generateObject = vi.fn();
  const initSpy = vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB');

  beforeEach(() => {
    generateObject.mockReset();
    initSpy.mockReset();
    initSpy.mockResolvedValue({ generateObject } as any);
  });

  it('initialises the runtime from DB with the caller-supplied provider', async () => {
    generateObject.mockResolvedValue({ ok: true });
    const ai = new AiGenerationService({} as any, 'user-1');
    await ai.generateObject(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'gpt-4o',
        provider: 'openai',
      },
      { metadata: { trigger: RequestTrigger.Chat } },
    );
    expect(initSpy).toHaveBeenCalledWith({}, 'user-1', 'openai', undefined);
  });

  it('forwards messages / model / schema / tools / thinking verbatim to the runtime', async () => {
    generateObject.mockResolvedValue({ name: 'Atlas' });
    const schema = {
      name: 'Person',
      schema: {
        properties: { name: { type: 'string' } },
        required: ['name'],
        type: 'object' as const,
      },
    };

    const ai = new AiGenerationService({} as any, 'user-1');
    await ai.generateObject(
      {
        messages: [{ content: 'pick a name', role: 'user' }],
        model: 'gpt-4o',
        provider: 'openai',
        schema,
        thinking: { type: 'disabled' },
      },
      { metadata: { trigger: RequestTrigger.Chat } },
    );

    const [payload] = generateObject.mock.calls[0];
    expect(payload).toEqual({
      messages: [{ content: 'pick a name', role: 'user' }],
      model: 'gpt-4o',
      schema,
      thinking: { type: 'disabled' },
      tools: undefined,
    });
  });

  it('forwards both options.metadata and options.tracing through to ModelRuntime.generateObject', async () => {
    generateObject.mockResolvedValue({});
    const ai = new AiGenerationService({} as any, 'user-1');
    await ai.generateObject(
      {
        messages: [],
        model: 'gpt-4o',
        provider: 'openai',
      },
      {
        metadata: { trigger: RequestTrigger.Chat },
        tracing: {
          promptVersion: 'v1.0',
          scenario: 'input_completion',
        },
      },
    );
    const [, options] = generateObject.mock.calls[0];
    expect(options).toMatchObject({
      metadata: { trigger: RequestTrigger.Chat },
      tracing: {
        promptVersion: 'v1.0',
        scenario: 'input_completion',
      },
    });
  });

  it('returns the runtime result with the typed cast applied', async () => {
    generateObject.mockResolvedValue({ completion: 'hello world' });
    const ai = new AiGenerationService({} as any, 'user-1');
    const result = await ai.generateObject<{ completion: string }>(
      { messages: [], model: 'gpt-4o', provider: 'openai' },
      { metadata: { trigger: RequestTrigger.Chat } },
    );
    expect(result.completion).toBe('hello world');
  });
});

describe('AiGenerationService.generateObject with a device-only provider', () => {
  const initSpy = vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB');

  beforeEach(() => {
    initSpy.mockReset();
    resolveProviderRelay.mockReset();
    resolveProviderRelay.mockResolvedValue({ runtimeProvider: 'ollama' });
  });

  const generate = () =>
    new AiGenerationService({} as any, 'user-1').generateObject(
      { messages: [{ content: 'hi', role: 'user' }], model: 'qwen3:1.7b', provider: 'ollama' },
      { metadata: { trigger: RequestTrigger.TopicSummary } },
    );

  // Topic auto summary, task lifecycle, verify: a workflow or a hook with no
  // browser tab. The server cannot reach the user's local model, so it must
  // not try — it fails at once, before any provider call.
  it('fails at once with no_executor in background work (no browser tab)', async () => {
    await expect(generate()).rejects.toMatchObject({
      error: { context: 'no_client_request', reason: 'no_executor' },
      errorType: 'ClientLlmExecutorUnavailable',
    });
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('never relays to a request that named a channel the user does not own', async () => {
    await expect(
      runWithLlmRelayRequest(
        { channel: 'llmcall:someone-else:0b7c1d2e-aaaa', clientId: 'tab-1' },
        'user-1',
        generate,
      ),
    ).rejects.toMatchObject({ error: { reason: 'no_executor' } });
  });
});
