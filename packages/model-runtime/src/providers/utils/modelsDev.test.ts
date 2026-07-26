// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetModelsDevCacheForTests,
  enrichWithModelsDev,
  fetchModelsDevRoutingMetadata,
  mapReasoningOptionsToExtendParams,
  resolveModelsDevModelList,
} from './modelsDev';

vi.mock('../../utils/modelParse', () => ({
  processMultiProviderModelList: vi.fn(async (list: Array<{ id: string }>) =>
    list.map((m) => ({ id: m.id, settings: (m as any).settings })),
  ),
}));

describe('mapReasoningOptionsToExtendParams', () => {
  it('maps toggle / budget / effort sets', () => {
    expect(mapReasoningOptionsToExtendParams('x', [{ type: 'toggle' }])).toEqual([
      'enableReasoning',
    ]);
    expect(
      mapReasoningOptionsToExtendParams('glm-5.2', [{ type: 'effort', values: ['high', 'max'] }]),
    ).toEqual(['glm5_2ReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('step-3.5-flash', [
        { type: 'effort', values: ['low', 'high'] },
      ]),
    ).toEqual(['step3_5ReasoningEffort']);
  });

  it('maps provider-specific effort sets', () => {
    expect(
      mapReasoningOptionsToExtendParams('claude-opus-4-8', [
        { type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
      ]),
    ).toEqual(['enableAdaptiveThinking', 'opus47Effort']);
    expect(
      mapReasoningOptionsToExtendParams('gpt-5.6-sol', [
        { type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
      ]),
    ).toEqual(['gpt5_6ReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('deepseek-v4-pro', [
        { type: 'toggle' },
        { type: 'effort', values: ['high', 'max'] },
      ]),
    ).toEqual(['deepseekV4ReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('grok-4.3', [
        { type: 'effort', values: ['low', 'medium', 'high'] },
      ]),
    ).toEqual(['grok4_3ReasoningEffort']);
  });

  it('maps min-only budgets and always-on reasoning', () => {
    expect(
      mapReasoningOptionsToExtendParams('claude-sonnet-4-6', [
        { type: 'budget_tokens', min: 1024 },
      ]),
    ).toEqual(['enableReasoning', 'reasoningBudgetToken']);
    expect(
      mapReasoningOptionsToExtendParams('kimi-k3', [{ type: 'effort', values: ['max'] }]),
    ).toBeUndefined();
  });
});

describe('fetchModelsDevRoutingMetadata', () => {
  beforeEach(() => {
    __resetModelsDevCacheForTests();
  });

  afterEach(() => {
    __resetModelsDevCacheForTests();
  });

  it('derives Anthropic and interleaved model ids from the shared catalog', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        opencode: {
          npm: '@ai-sdk/openai-compatible',
          models: {
            claude: {
              id: 'claude',
              interleaved: { field: 'reasoning_content' },
              provider: { npm: '@ai-sdk/anthropic' },
            },
            compatible: { id: 'compatible' },
            gpt: { id: 'gpt', provider: { npm: '@ai-sdk/openai' } },
            qwen: { id: 'qwen', provider: { npm: '@ai-sdk/anthropic' } },
          },
        },
      }),
    }) as any;

    const metadata = await fetchModelsDevRoutingMetadata('opencode');

    expect(metadata.available).toBe(true);
    expect(metadata.interleavedModelIds).toEqual(new Set(['claude']));
    expect(metadata.modelIdsBySdk).toEqual({
      '@ai-sdk/anthropic': ['claude', 'qwen'],
      '@ai-sdk/openai': ['gpt'],
      '@ai-sdk/openai-compatible': ['compatible'],
    });
  });
});

describe('enrichWithModelsDev', () => {
  it('prefers models.dev extendParams over empty bank', () => {
    const result = enrichWithModelsDev('glm-5.1', {
      id: 'glm-5.1',
      name: 'GLM-5.1',
      reasoning: true,
      tool_call: true,
      reasoning_options: [{ type: 'toggle' }],
      limit: { context: 200_000, output: 131_072 },
    });
    expect(result.displayName).toBe('GLM-5.1');
    expect(result.contextWindowTokens).toBe(200_000);
    expect(result.settings?.extendParams).toEqual(['enableReasoning']);
  });
});

describe('resolveModelsDevModelList', () => {
  beforeEach(() => {
    __resetModelsDevCacheForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    __resetModelsDevCacheForTests();
  });

  it('uses API list when available and enriches from models.dev', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'zhipuai-coding-plan': {
          models: {
            'glm-5.2': {
              id: 'glm-5.2',
              name: 'GLM-5.2',
              reasoning: true,
              tool_call: true,
              reasoning_options: [{ type: 'effort', values: ['high', 'max'] }],
              limit: { context: 1_000_000, output: 131_072 },
            },
          },
        },
      }),
    }) as any;

    const client = {
      models: {
        list: vi.fn().mockResolvedValue({ data: [{ id: 'glm-5.2' }] }),
      },
    };

    const result = await resolveModelsDevModelList({
      bankModels: [{ id: 'glm-5.2', settings: { extendParams: ['enableReasoning'] } }],
      client,
      modelsDevProvider: 'zhipuai-coding-plan',
      providerId: 'glmcodingplan',
    });

    expect(client.models.list).toHaveBeenCalled();
    expect(result[0].id).toBe('glm-5.2');
    expect(result[0].settings?.extendParams).toEqual(['glm5_2ReasoningEffort']);
  });

  it('falls back to the static bank when the official API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'minimax-cn-coding-plan': {
          models: {
            'MiniMax-M3': {
              id: 'MiniMax-M3',
              name: 'MiniMax M3',
              reasoning: true,
              tool_call: true,
              reasoning_options: [{ type: 'toggle' }],
              limit: { context: 1_000_000, output: 128_000 },
            },
            'old-model': {
              id: 'old-model',
              name: 'Old',
            },
          },
        },
      }),
    }) as any;

    const client = {
      models: {
        list: vi.fn().mockRejectedValue(new Error('no api')),
      },
    };

    const result = await resolveModelsDevModelList({
      bankModels: [{ id: 'MiniMax-M3' }],
      client,
      modelsDevProvider: 'minimax-cn-coding-plan',
      providerId: 'minimaxcodingplan',
    });

    expect(result.map((m: any) => m.id)).toEqual(['MiniMax-M3']);
    expect(result[0].settings?.extendParams).toEqual(['enableReasoning']);
  });

  it('uses bank order when the official API returns an empty list', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'alibaba-coding-plan-cn': {
          models: {
            'qwen3.7-plus': { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', tool_call: true },
            'extra-model': { id: 'extra-model', name: 'Extra', tool_call: true },
            'glm-5': {
              id: 'glm-5',
              name: 'GLM-5',
              tool_call: true,
              reasoning_options: [{ type: 'toggle' }],
            },
          },
        },
      }),
    }) as any;

    const result = await resolveModelsDevModelList({
      bankModels: [
        { id: 'qwen3.7-plus' },
        { id: 'glm-5', settings: { extendParams: ['enableReasoning'] } },
      ],
      client: { models: { list: vi.fn().mockResolvedValue({ data: [] }) } },
      modelsDevProvider: 'alibaba-coding-plan-cn',
      providerId: 'bailiancodingplan',
    });

    expect(result.map((m: any) => m.id)).toEqual(['qwen3.7-plus', 'glm-5']);
  });
});
