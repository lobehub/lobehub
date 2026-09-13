import type { CallLLMPayload } from '@lobechat/agent-runtime';
import { MessagesEngine } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { resolveServerCallLlmContextHints } from './serverCallLlmContextHints';

const loadModelsMock = vi.hoisted(() => vi.fn());
const findByIdAndProviderMock = vi.hoisted(() => vi.fn());
const getModelReasoningConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: loadModelsMock,
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    findByIdAndProvider = findByIdAndProviderMock;
    getModelReasoningConfig = getModelReasoningConfigMock;
  },
}));

const findTopicByIdMock = vi.hoisted(() => vi.fn());
const topicModelCtorMock = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    constructor(...args: unknown[]) {
      topicModelCtorMock(...args);
    }
    findById = findTopicByIdMock;
  },
}));

const createCtx = (): RuntimeExecutorContext =>
  ({
    messageModel: {} as RuntimeExecutorContext['messageModel'],
    operationId: 'operation-1',
    serverDB: {} as RuntimeExecutorContext['serverDB'],
    stepIndex: 0,
    streamManager: {} as RuntimeExecutorContext['streamManager'],
    toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
    userId: 'user-1',
  }) satisfies RuntimeExecutorContext;

const llmPayload = { messages: [] } as unknown as CallLLMPayload;

beforeEach(() => {
  vi.clearAllMocks();

  loadModelsMock.mockResolvedValue([
    {
      abilities: {},
      displayName: 'GPT-4',
      id: 'gpt-4',
      providerId: 'openai',
      settings: { extendParams: ['reasoningEffort'] },
    },
    {
      abilities: {},
      displayName: 'DeepSeek V4 Pro',
      id: 'deepseek-v4-pro',
      providerId: 'deepseek',
      settings: { extendParams: ['deepseekV4ReasoningEffort'] },
    },
    {
      abilities: {},
      displayName: 'DeepSeek V4 Flash',
      id: 'deepseek-v4-flash',
      providerId: 'deepseek',
      settings: { extendParams: ['deepseekV4GAReasoningEffort'] },
    },
    {
      abilities: {},
      displayName: 'GPT-4o Mini',
      id: 'gpt-4o-mini',
      providerId: 'openai',
      settings: {},
    },
  ]);
  findByIdAndProviderMock.mockResolvedValue(undefined);
  getModelReasoningConfigMock.mockResolvedValue(undefined);
  findTopicByIdMock.mockResolvedValue(undefined);
});

describe('resolveServerCallLlmContextHints - user media capabilities', () => {
  it.each(['lookup failure', 'settings changed'])(
    'preserves discovered vision after %s',
    async (scenario) => {
      if (scenario === 'lookup failure') {
        findByIdAndProviderMock.mockRejectedValue(new Error('Temporary database failure'));
      } else {
        findByIdAndProviderMock.mockResolvedValue({ abilities: { vision: false } });
      }
      const hints = await resolveServerCallLlmContextHints({
        ctx: {
          ...createCtx(),
          modelRuntimeConfig: {
            mediaCapabilities: { vision: true },
            model: 'custom-model',
            provider: 'custom-provider',
          },
        },
        llmPayload,
        model: 'custom-model',
        provider: 'custom-provider',
      });

      expect(hints.capabilities.isCanUseVision('custom-model', 'custom-provider')).toBe(true);
    },
  );

  it.each([
    { model: 'other-model', provider: 'custom-provider' },
    { model: 'custom-model', provider: 'other-provider' },
  ])('does not reuse a snapshot for $model/$provider', async ({ model, provider }) => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: {
        ...createCtx(),
        modelRuntimeConfig: {
          mediaCapabilities: { vision: true },
          model: 'custom-model',
          provider: 'custom-provider',
        },
      },
      llmPayload,
      model,
      provider,
    });

    expect(hints.capabilities.isCanUseVision(model, provider)).toBe(false);
  });

  it('keeps an unknown-model snapshot disabled after settings change', async () => {
    findByIdAndProviderMock.mockResolvedValue({ abilities: { vision: true } });
    const hints = await resolveServerCallLlmContextHints({
      ctx: {
        ...createCtx(),
        modelRuntimeConfig: {
          mediaCapabilities: {},
          model: 'custom-model',
          provider: 'custom-provider',
        },
      },
      llmPayload,
      model: 'custom-model',
      provider: 'custom-provider',
    });

    expect(hints.capabilities.isCanUseVision('custom-model', 'custom-provider')).toBe(false);
  });

  it('keeps custom-model images in the native payload and advertises user-enabled vision', async () => {
    findByIdAndProviderMock.mockResolvedValue({ abilities: { vision: true } });
    const model = 'custom-vision-model';
    const provider = 'custom-provider';
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      llmPayload,
      model,
      provider,
    });
    const result = await new MessagesEngine({
      capabilities: hints.capabilities,
      enableSystemDate: false,
      messages: [
        {
          content: 'Describe this image',
          createdAt: 1,
          id: 'message-1',
          imageList: [{ id: 'image-1', url: 'https://example.com/image.png' }],
          role: 'user',
          updatedAt: 1,
        } as UIChatMessage,
      ],
      model,
      provider,
    }).process();

    expect
      .soft(result.messages.find((message) => message.role === 'system')?.content)
      .toContain('vision=true');
    expect(result.messages.find((message) => message.role === 'user')?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          image_url: expect.objectContaining({ url: 'https://example.com/image.png' }),
          type: 'image_url',
        }),
      ]),
    );
  });

  it.each(['audio', 'video', 'vision'] as const)(
    'honors a user override for builtin %s capability',
    async (ability) => {
      loadModelsMock.mockResolvedValue([
        { abilities: { [ability]: false }, id: 'model', providerId: 'provider' },
      ]);
      findByIdAndProviderMock.mockResolvedValue({ abilities: { [ability]: true } });
      const hints = await resolveServerCallLlmContextHints({
        ctx: createCtx(),
        llmPayload,
        model: 'model',
        provider: 'provider',
      });
      const selectors = {
        audio: hints.capabilities.isCanUseAudio,
        video: hints.capabilities.isCanUseVideo,
        vision: hints.capabilities.isCanUseVision,
      };
      expect(selectors[ability]('model', 'provider')).toBe(true);
      expect(selectors[ability]('model', 'another-provider')).toBe(false);
    },
  );

  it.each([
    { abilities: { vision: false }, expected: false },
    { abilities: { functionCall: true }, expected: false },
    { abilities: {}, expected: true },
    { abilities: null, expected: true },
    { abilities: undefined, expected: true },
  ])('matches the client abilities replacement for $abilities', async ({ abilities, expected }) => {
    loadModelsMock.mockResolvedValue([
      { abilities: { vision: true }, id: 'model', providerId: 'provider' },
    ]);
    findByIdAndProviderMock.mockResolvedValue({ abilities });
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      llmPayload,
      model: 'model',
      provider: 'provider',
    });
    expect(hints.capabilities.isCanUseVision('model', 'provider')).toBe(expected);
  });

  it('does not apply the active row to a different model under the same provider', async () => {
    findByIdAndProviderMock.mockResolvedValue({ abilities: { vision: true } });
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      llmPayload,
      model: 'custom-model',
      provider: 'custom-provider',
    });
    expect(hints.capabilities.isCanUseVision('another-model', 'custom-provider')).toBe(false);
  });
});

describe('resolveServerCallLlmContextHints - topic reasoning pin', () => {
  const ctxWithTopic = () => ({ ...createCtx(), topicId: 'topic-1' });

  it.each([
    ['supervisor', 'high'],
    ['member', 'low'],
  ])('uses group topic reasoning only for its owning agent (%s)', async (id, effort) => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });
    findTopicByIdMock.mockResolvedValue({
      agentId: 'supervisor',
      groupId: 'group-1',
      metadata: { reasoningConfig: { reasoningEffort: 'high' } },
      model: 'gpt-4',
      provider: 'openai',
    });
    const hints = await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { id, chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });
    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: effort });
  });

  it('should let the topic pin win over the model-instance config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });
    findTopicByIdMock.mockResolvedValue({
      metadata: { reasoningConfig: { reasoningEffort: 'high' } },
      model: 'gpt-4',
      provider: 'openai',
    });

    const hints = await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(findTopicByIdMock).toHaveBeenCalledWith('topic-1');
    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'high' });
  });

  it('should read share-visitor topics too (they carry a senderId)', async () => {
    findTopicByIdMock.mockResolvedValue({
      metadata: { reasoningConfig: { reasoningEffort: 'high' } },
      model: 'gpt-4',
      provider: 'openai',
    });

    await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(topicModelCtorMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      undefined,
      undefined,
      { includeShareVisitor: true },
    );
  });

  it('should treat an empty topic pin as the model defaults', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });
    findTopicByIdMock.mockResolvedValue({
      metadata: { reasoningConfig: {} },
      model: 'gpt-4',
      provider: 'openai',
    });

    const hints = await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should ignore a topic pin taken for another model (sub-agent modelOverride)', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });
    findTopicByIdMock.mockResolvedValue({
      metadata: { reasoningConfig: { reasoningEffort: 'high' } },
      model: 'other-model',
      provider: 'openai',
    });

    const hints = await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).toHaveBeenCalledWith('gpt-4', 'openai');
    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'low' });
  });

  it('should fall back to the model-instance config for a legacy topic without a pin', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });
    findTopicByIdMock.mockResolvedValue({ metadata: {}, model: 'gpt-4', provider: 'openai' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'low' });
  });

  it('should still let explicit sub-agent overrides win over the topic pin', async () => {
    findTopicByIdMock.mockResolvedValue({
      metadata: { reasoningConfig: { reasoningEffort: 'high' } },
      model: 'gpt-4',
      provider: 'openai',
    });

    const hints = await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: {
        agent: {
          chatConfig: {},
          subAgentChatConfigOverride: { reasoningEffort: 'medium' },
        },
      },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'medium' });
  });

  it('should not read the topic for models without reasoning extend params', async () => {
    await resolveServerCallLlmContextHints({
      ctx: ctxWithTopic(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4o-mini',
      provider: 'openai',
    });

    expect(findTopicByIdMock).not.toHaveBeenCalled();
  });
});

describe('resolveServerCallLlmContextHints - model-instance reasoning config', () => {
  it.each([
    { preserveThinking: undefined, provider: 'meta', replay: true },
    { preserveThinking: false, provider: 'meta', replay: true },
    { preserveThinking: true, provider: 'meta', replay: true },
    { preserveThinking: undefined, provider: 'openai', replay: false },
    { preserveThinking: false, provider: 'openai', replay: false },
    { preserveThinking: true, provider: 'openai', replay: false },
  ])(
    'should preserve opaque Meta replay without changing other providers ($provider, preserveThinking=$preserveThinking)',
    async ({ preserveThinking, provider, replay }) => {
      const model = 'muse-spark-1.3';
      loadModelsMock.mockResolvedValue([
        { abilities: { reasoning: true }, id: model, providerId: provider, settings: {} },
      ]);
      const reasoning = {
        responseItems: [
          {
            encrypted_content:
              'lobe-scoped-state-v1:reasoning:0123456789abcdef0123456789abcdef:opaque',
            id: 'rs_meta',
            summary: [],
            type: 'reasoning',
          },
        ],
      };
      const messages = [
        { content: 'Hello', id: 'user-1', role: 'user' },
        { content: 'Hi', id: 'assistant-1', reasoning, role: 'assistant' },
        { content: 'Continue', id: 'user-2', role: 'user' },
      ];
      const hints = await resolveServerCallLlmContextHints({
        ctx: createCtx(),
        world: { agent: { chatConfig: { preserveThinking } } },
        llmPayload: { messages } as unknown as CallLLMPayload,
        model,
        provider,
      });

      expect(hints.shouldReplayAssistantReasoning).toBe(replay);
      expect(hints.messagesForContext).toEqual([
        messages[0],
        {
          content: 'Hi',
          id: 'assistant-1',
          ...(replay && { reasoning }),
          role: 'assistant',
        },
        messages[2],
      ]);
      expect(messages[1].reasoning).toEqual(reasoning);
    },
  );

  it('should apply the user model-instance reasoning config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'high' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).toHaveBeenCalledWith('gpt-4', 'openai');
    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'high' });
  });

  it('should resolve extend params from the user DB row for custom models', async () => {
    findByIdAndProviderMock.mockResolvedValue({
      displayName: 'My Custom Reasoner',
      settings: { extendParams: ['reasoningEffort'] },
    });
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'high' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'my-custom-model',
      provider: 'custom-provider',
    });

    expect(getModelReasoningConfigMock).toHaveBeenCalledWith('my-custom-model', 'custom-provider');
    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'high' });
  });

  it('should honor reasoning extend params added to a builtin model via DB settings', async () => {
    // Provider-settings edits store extendParams on the user's own model row;
    // the client merges them over the bundled card, so the server must too
    findByIdAndProviderMock.mockResolvedValue({
      settings: { extendParams: ['reasoningEffort'] },
    });
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'high' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4o-mini',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).toHaveBeenCalledWith('gpt-4o-mini', 'openai');
    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'high' });
  });

  it('should treat an explicitly emptied extendParams row as an opt-out', async () => {
    // Clearing extendParams in provider settings replaces the card's list on
    // the client (array-replacement merge); the server must not fall back to
    // the bundled card and resurrect the removed reasoning params
    findByIdAndProviderMock.mockResolvedValue({ settings: { extendParams: [] } });
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'high' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should skip the reasoning config DB read for models without reasoning extend params', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'gpt-4o-mini',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should ignore stale reasoning fields left in agent chatConfig', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: { reasoningEffort: 'low' } } },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should apply extend params from instance config even without agent chatConfig', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'medium' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'medium' });
  });

  it('should let explicit sub-agent overrides win over the instance config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: {
        agent: {
          chatConfig: {},
          subAgentChatConfigOverride: { reasoningEffort: 'high' },
        },
      },
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'high' });
  });

  it('should derive the DeepSeek V4 thinking opt-out from the instance config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ deepseekV4ReasoningEffort: 'none' });

    const hints = await resolveServerCallLlmContextHints({
      // stale agent value says 'high', but the instance config opts out
      ctx: createCtx(),
      world: { agent: { chatConfig: { deepseekV4ReasoningEffort: 'high' } } },
      llmPayload,
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
    });

    expect(hints.shouldReplayAssistantReasoning).toBe(false);
    expect(hints.resolvedExtendParams).toEqual({ thinking: { type: 'disabled' } });
  });

  it('should derive the DeepSeek V4 GA thinking opt-out from the instance config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ deepseekV4GAReasoningEffort: 'none' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: { deepseekV4GAReasoningEffort: 'high' } } },
      llmPayload,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });

    expect(hints.shouldReplayAssistantReasoning).toBe(false);
    expect(hints.resolvedExtendParams).toEqual({ thinking: { type: 'disabled' } });
  });

  /**
   * Replay-off is not the official 400. A leftover preview `none` on a GA-only
   * card still suppresses replay today, but `applyModelExtendParams` ignores
   * that leftover so thinking stays on and the payload builder emits the
   * whitespace placeholder rather than omitting the thinking field.
   */
  it('does not disable thinking for leftover preview none on a GA-only card', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ deepseekV4ReasoningEffort: 'none' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });

    expect(hints.shouldReplayAssistantReasoning).toBe(false);
    expect(hints.resolvedExtendParams?.thinking).not.toEqual({ type: 'disabled' });
  });

  it('should keep DeepSeek V4 forced reasoning replay when no opt-out is saved', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx(),
      world: { agent: { chatConfig: {} } },
      llmPayload,
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
    });

    expect(hints.shouldReplayAssistantReasoning).toBe(true);
  });

  it('should not read the instance config when the ctx has no user scope', async () => {
    const ctx = createCtx();
    ctx.userId = undefined;

    await resolveServerCallLlmContextHints({
      ctx,
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
  });
});
