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
