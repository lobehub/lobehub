import type { CallLLMPayload } from '@lobechat/agent-runtime';
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

const createCtx = (agentConfig: any): RuntimeExecutorContext =>
  ({
    agentConfig,
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
});

describe('resolveServerCallLlmContextHints - model-instance reasoning config', () => {
  it('should apply the user model-instance reasoning config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'high' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx({ chatConfig: {} }),
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
      ctx: createCtx({ chatConfig: {} }),
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
      ctx: createCtx({ chatConfig: {} }),
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
      ctx: createCtx({ chatConfig: {} }),
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should skip the reasoning config DB read for models without reasoning extend params', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx({ chatConfig: {} }),
      llmPayload,
      model: 'gpt-4o-mini',
      provider: 'openai',
    });

    expect(getModelReasoningConfigMock).not.toHaveBeenCalled();
    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should ignore stale reasoning fields left in agent chatConfig', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx({ chatConfig: { reasoningEffort: 'low' } }),
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({});
  });

  it('should apply extend params from instance config even without agent chatConfig', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'medium' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx({}),
      llmPayload,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(hints.resolvedExtendParams).toEqual({ reasoning_effort: 'medium' });
  });

  it('should let explicit sub-agent overrides win over the instance config', async () => {
    getModelReasoningConfigMock.mockResolvedValue({ reasoningEffort: 'low' });

    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx({
        chatConfig: {},
        subAgentChatConfigOverride: { reasoningEffort: 'high' },
      }),
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
      ctx: createCtx({ chatConfig: { deepseekV4ReasoningEffort: 'high' } }),
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
      ctx: createCtx({ chatConfig: { deepseekV4GAReasoningEffort: 'high' } }),
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
      ctx: createCtx({ chatConfig: {} }),
      llmPayload,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });

    expect(hints.shouldReplayAssistantReasoning).toBe(false);
    expect(hints.resolvedExtendParams?.thinking).not.toEqual({ type: 'disabled' });
  });

  it('should keep DeepSeek V4 forced reasoning replay when no opt-out is saved', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx: createCtx({ chatConfig: {} }),
      llmPayload,
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
    });

    expect(hints.shouldReplayAssistantReasoning).toBe(true);
  });

  it('should not read the instance config when the ctx has no user scope', async () => {
    const ctx = createCtx({ chatConfig: {} });
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
