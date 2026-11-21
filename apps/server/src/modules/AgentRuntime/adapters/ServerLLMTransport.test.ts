// @vitest-environment node
import type { LLMAttemptInput } from '@lobechat/agent-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { tracer as agentRuntimeTracer } from '@lobechat/observability-otel/modules/agent-runtime';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initModelRuntimeFromDB,
  resolveProviderResponseApiMode,
  resolveServerModel,
} from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { ServerLLMTransport } from './ServerLLMTransport';

// Hoisted so every `new AiModelModel(...)` inside the transport shares one
// controllable row lookup; per-test resets keep implementations from leaking
// across tests the way `mockImplementation` on the constructor would.
const findByIdAndProviderMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  resolveProviderResponseApiMode: vi.fn(async () => undefined),
  resolveServerModel: vi.fn(),
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    findByIdAndProvider = findByIdAndProviderMock;
  },
}));

vi.mock('../llmRelay/resolveLlmExecutionSite', () => ({
  resolveLlmExecutionSite: vi.fn(async () => ({ site: 'server' })),
}));

describe('ServerLLMTransport.stream · conversation affinity', () => {
  it('retains the conversation ID across compression requests and runtime recreation', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    for (const topicId of ['topic-1', 'topic-1', 'topic-2']) {
      const ctx = { topicId, userId: 'user-1' } as RuntimeExecutorContext;
      await new ServerLLMTransport(ctx).stream({
        messages: [],
        model: 'glm-5',
        provider: 'opencodecodingplan',
      });
    }

    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls.map(([, options]) => options.metadata.topicId)).toEqual([
      'topic-1',
      'topic-1',
      'topic-2',
    ]);
  });

  it('tags compression requests with the context compression trigger', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const ctx = { topicId: 'topic-1', userId: 'user-1' } as RuntimeExecutorContext;
    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'glm-5',
      provider: 'opencodecodingplan',
    });

    expect(chat.mock.calls[0][1].metadata.trigger).toBe(RequestTrigger.ContextCompression);
  });
});

describe('ServerLLMTransport.stream · deployment name', () => {
  // Codex P1 (4255361517): clear the module-level `resolveServerModel` mock
  // before each test instead of relying on Vitest's default `clearMocks`
  // behavior, so the zero-call assertion below cannot inherit residual calls
  // from the live-resolution and rejection tests above.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries the frozen card deployment name for a compression model equal to the run model', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const ctx = {
      loadAgentState: vi.fn(async () => ({
        modelRuntimeConfig: {
          model: 'deepseek-v4-pro-ga',
          modelFacts: {
            cards: [
              {
                deploymentName: 'deepseek-v4-pro-ga-260813',
                id: 'deepseek-v4-pro-ga',
                providerId: 'volcengine',
              },
            ],
            model: 'deepseek-v4-pro-ga',
            provider: 'volcengine',
          },
          provider: 'volcengine',
        },
      })),
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    expect(chat.mock.calls[0][0].deploymentName).toBe('deepseek-v4-pro-ga-260813');
  });

  it('resolves the deployment catalog live for a compression model outside the frozen cards', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'deepseek-v4-pro-ga-260813',
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    const ctx = {
      loadAgentState: vi.fn(async () => ({
        modelRuntimeConfig: {
          cards: [],
          model: 'other-model',
          modelFacts: { cards: [], model: 'other-model', provider: 'volcengine' },
          provider: 'volcengine',
        },
      })),
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    expect(resolveServerModel).toHaveBeenCalledWith('volcengine', 'deepseek-v4-pro-ga');
    expect(chat.mock.calls[0][0].deploymentName).toBe('deepseek-v4-pro-ga-260813');
  });

  it('keeps the bare model id when the deployment catalog cannot resolve it', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockRejectedValue(
      new Error('The selected server model is not available'),
    );

    const ctx = {
      loadAgentState: vi.fn(async () => undefined),
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'some-unknown-model',
      provider: 'volcengine',
    });

    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
  });

  it('does not touch deploymentName for providers outside the deployment catalog', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const ctx = {
      loadAgentState: vi.fn(async () => undefined),
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
  });

  it('strips the frozen card deployment name for a non-consuming provider (qwen)', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const ctx = {
      loadAgentState: vi.fn(async () => ({
        modelRuntimeConfig: {
          model: 'qwen3-vl-flash',
          modelFacts: {
            cards: [
              {
                deploymentName: 'qwen3-vl-flash-prod',
                id: 'qwen3-vl-flash',
                providerId: 'qwen',
              },
            ],
            model: 'qwen3-vl-flash',
            provider: 'qwen',
          },
          provider: 'qwen',
        },
      })),
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'qwen3-vl-flash',
      provider: 'qwen',
    });

    // The qwen adapter leaves the field in `...rest` and the OpenAI-compatible
    // factory forwards unknown payload fields upstream — the internal mapping
    // must never reach the wire for providers that don't consume it.
    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
    // ...and the live deployment catalog is not even consulted.
    expect(resolveServerModel).not.toHaveBeenCalled();
  });

  it('freezes the absence of an alias when the frozen card has no deploymentName', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'bundled-azure-endpoint',
      model: 'my-custom-model',
      provider: 'azure',
    });

    const ctx = {
      loadAgentState: vi.fn(async () => ({
        modelRuntimeConfig: {
          model: 'my-custom-model',
          modelFacts: {
            cards: [{ id: 'my-custom-model', providerId: 'azure' }],
            model: 'my-custom-model',
            provider: 'azure',
          },
          provider: 'azure',
        },
      })),
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'my-custom-model',
      provider: 'azure',
    });

    // Codex P2 (4259967307): the snapshot is authoritative — a matching card
    // without an alias freezes that absence, so the catalog (possibly changed
    // since the snapshot) is never consulted and the payload keeps the bare id.
    expect(resolveServerModel).not.toHaveBeenCalled();
    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
  });

  it('prefers the user-configured alias over the deployment catalog for a custom model', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    findByIdAndProviderMock.mockResolvedValue({
      config: { deploymentName: 'my-custom-azure-endpoint' },
      id: 'my-custom-model',
    });
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'bundled-azure-endpoint',
      model: 'my-custom-model',
      provider: 'azure',
    });

    const ctx = {
      loadAgentState: vi.fn(async () => undefined),
      operationId: 'op-1',
      serverDB: {},
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'my-custom-model',
      provider: 'azure',
    });

    // The catalog is never consulted — the user row alone names the endpoint.
    expect(resolveServerModel).not.toHaveBeenCalled();
    expect(chat.mock.calls[0][0].deploymentName).toBe('my-custom-azure-endpoint');
  });

  it('falls back to the deployment catalog when the user row has no alias', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    findByIdAndProviderMock.mockResolvedValue(null);
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'bundled-azure-endpoint',
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    const ctx = {
      loadAgentState: vi.fn(async () => undefined),
      operationId: 'op-1',
      serverDB: {},
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext;

    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    expect(resolveServerModel).toHaveBeenCalledWith('volcengine', 'deepseek-v4-pro-ga');
    expect(chat.mock.calls[0][0].deploymentName).toBe('bundled-azure-endpoint');
  });
});

describe('ServerLLMTransport.runAttempt · deployment name without frozen model facts', () => {
  // Codex P1 (4257694112): operations without a `modelFacts` snapshot —
  // agent-signal memory actions, persisted operations predating `modelFacts` —
  // must still resolve the deployment alias live, or deployment-catalog
  // providers keep receiving a logical id they 404 on.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createAttemptCtx = () =>
    ({
      operationId: 'op-1',
      serverDB: {},
      stepIndex: 0,
      streamManager: {
        publishStreamChunk: vi.fn().mockResolvedValue('chunk-id'),
        publishStreamEvent: vi.fn().mockResolvedValue('event-id'),
      },
      toolExecutionService: {},
      userId: 'user-1',
    }) as unknown as RuntimeExecutorContext;

  const createAttemptInput = (state: Record<string, unknown>): LLMAttemptInput =>
    ({
      assistantMessageId: 'msg-1',
      attempt: 1,
      context: {
        messages: [{ content: 'Question', role: 'user' }],
        modelParameters: {},
        replayAssistantReasoning: false,
        resolvedTools: {
          enabledToolIds: [],
          executorMap: {},
          manifestMap: {},
          promptManifestMap: {},
          sourceMap: {},
          tools: [],
        },
      } as unknown as LLMAttemptInput['context'],
      events: [],
      maxAttempts: 6,
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
      state,
    }) as unknown as LLMAttemptInput;

  it('resolves the deployment catalog live when the operation has no modelFacts', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'deepseek-v4-pro-ga-260813',
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(createAttemptInput({}));

    expect(resolveServerModel).toHaveBeenCalledWith('volcengine', 'deepseek-v4-pro-ga');
    expect(chat.mock.calls[0][0].deploymentName).toBe('deepseek-v4-pro-ga-260813');
  });

  it('shares one live resolution across attempts instead of paying one per attempt', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'deepseek-v4-pro-ga-260813',
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(createAttemptInput({}));
    await transport.runAttempt(createAttemptInput({}));

    expect(resolveServerModel).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('keeps the bare model id when the live catalog cannot resolve the model', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockRejectedValue(
      new Error('The selected server model is not available'),
    );

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(createAttemptInput({}));

    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
  });

  it('resolves the user-configured alias live when the operation has no modelFacts', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    findByIdAndProviderMock.mockResolvedValue({
      config: { deploymentName: 'my-custom-azure-endpoint' },
      id: 'my-custom-model',
    });

    const input = createAttemptInput({}) as any;
    input.model = 'my-custom-model';
    input.provider = 'azure';

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(input);

    expect(chat.mock.calls[0][0].deploymentName).toBe('my-custom-azure-endpoint');
  });

  it('freezes the absence of an alias on the attempt path too', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveServerModel).mockResolvedValue({
      deploymentName: 'deepseek-v4-pro-ga-260813',
      model: 'deepseek-v4-pro-ga',
      provider: 'volcengine',
    });

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(
      createAttemptInput({
        modelRuntimeConfig: {
          model: 'deepseek-v4-pro-ga',
          modelFacts: {
            cards: [{ id: 'deepseek-v4-pro-ga', providerId: 'volcengine' }],
            model: 'deepseek-v4-pro-ga',
            provider: 'volcengine',
          },
          provider: 'volcengine',
        },
      }),
    );

    // Codex P2 (4259967307): same contract as `stream()` — a matching frozen
    // card without an alias freezes the absence, the live catalog is not
    // consulted, and the attempt payload keeps the bare model id.
    expect(resolveServerModel).not.toHaveBeenCalled();
    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
  });

  it('strips the frozen card deployment name for a non-consuming provider (qwen)', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const input = createAttemptInput({
      modelRuntimeConfig: {
        model: 'qwen3-vl-flash',
        modelFacts: {
          cards: [
            {
              deploymentName: 'qwen3-vl-flash-prod',
              id: 'qwen3-vl-flash',
              providerId: 'qwen',
            },
          ],
          model: 'qwen3-vl-flash',
          provider: 'qwen',
        },
        provider: 'qwen',
      },
    }) as any;
    input.model = 'qwen3-vl-flash';
    input.provider = 'qwen';

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(input);

    // Codex P2 (4258586588): the frozen alias sits behind the same provider
    // gate as the live resolution — the qwen adapter forwards unknown payload
    // fields upstream, so the internal mapping must never reach the wire on
    // the attempt path either.
    expect(chat.mock.calls[0][0].deploymentName).toBeUndefined();
    expect(resolveServerModel).not.toHaveBeenCalled();
  });
});

describe('ServerLLMTransport.createTrace · streaming mode', () => {
  it('records the streaming mode the built context resolved, not the operation default', () => {
    const startSpan = vi.spyOn(agentRuntimeTracer, 'startSpan');
    const ctx = { operationId: 'op-1', stepIndex: 0, userId: 'user-1' } as RuntimeExecutorContext;

    new ServerLLMTransport(ctx).createTrace({
      assistantMessageId: 'msg-1',
      context: {
        messages: [],
        modelParameters: { stream: false },
        replayAssistantReasoning: false,
      },
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(startSpan).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        attributes: expect.objectContaining({ 'gen_ai.request.stream': false }),
      }),
    );

    // An explicit operation-level stream is already folded into the context;
    // without any context the operation value still applies.
    new ServerLLMTransport({ ...ctx, stream: false }).createTrace({
      assistantMessageId: 'msg-2',
      model: 'gpt-4',
      provider: 'openai',
    });
    expect(startSpan).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        attributes: expect.objectContaining({ 'gen_ai.request.stream': false }),
      }),
    );
  });
});

describe('ServerLLMTransport · provider Responses API preference', () => {
  // The browser applies `ai_providers.config.enableResponseApi` in
  // `services/chat#getChatCompletion`. A gateway run makes the provider call on the
  // server, which used to drop that field and always land on `/v1/chat/completions`.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createAttemptCtx = () =>
    ({
      operationId: 'op-1',
      serverDB: {},
      stepIndex: 0,
      streamManager: {
        publishStreamChunk: vi.fn().mockResolvedValue('chunk-id'),
        publishStreamEvent: vi.fn().mockResolvedValue('event-id'),
      },
      toolExecutionService: {},
      userId: 'user-1',
    }) as unknown as RuntimeExecutorContext;

  const createAttemptInput = (): LLMAttemptInput =>
    ({
      assistantMessageId: 'msg-1',
      attempt: 1,
      context: {
        messages: [{ content: 'Question', role: 'user' }],
        modelParameters: {},
        replayAssistantReasoning: false,
        resolvedTools: {
          enabledToolIds: [],
          executorMap: {},
          manifestMap: {},
          promptManifestMap: {},
          sourceMap: {},
          tools: [],
        },
      } as unknown as LLMAttemptInput['context'],
      events: [],
      maxAttempts: 6,
      model: 'gpt-4o',
      provider: 'openai',
      state: {},
    }) as unknown as LLMAttemptInput;

  it('forwards the switch onto the attempt payload', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveProviderResponseApiMode).mockResolvedValue('responses');

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(createAttemptInput());

    expect(resolveProviderResponseApiMode).toHaveBeenCalledWith({}, 'user-1', 'openai', undefined);
    expect(chat.mock.calls[0][0].apiMode).toBe('responses');
  });

  it('keeps the model default when the provider has no explicit preference', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveProviderResponseApiMode).mockResolvedValue(undefined);

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(createAttemptInput());

    expect(chat.mock.calls[0][0]).not.toHaveProperty('apiMode');
  });

  it('resolves the preference once per provider across attempts', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveProviderResponseApiMode).mockResolvedValue('chatCompletion');

    const transport = new ServerLLMTransport(createAttemptCtx());
    await transport.runAttempt(createAttemptInput());
    await transport.runAttempt(createAttemptInput());

    expect(resolveProviderResponseApiMode).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls.map(([payload]) => payload.apiMode)).toEqual([
      'chatCompletion',
      'chatCompletion',
    ]);
  });

  it('applies the same preference to compression streams', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));
    vi.mocked(resolveProviderResponseApiMode).mockResolvedValue('responses');

    const ctx = { topicId: 'topic-1', userId: 'user-1' } as RuntimeExecutorContext;
    await new ServerLLMTransport(ctx).stream({
      messages: [],
      model: 'gpt-4o',
      provider: 'openai',
    });

    expect(chat.mock.calls[0][0].apiMode).toBe('responses');
  });
});
