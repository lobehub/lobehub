import { loadModels } from '@lobechat/business-model-bank/model-config';
import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveSystemAgentModelConfig } from './modelConfig';

const availableModels = [
  {
    abilities: {},
    id: 'deepseek-v4-pro',
    providerId: 'lobehub',
    type: 'chat',
  },
  {
    abilities: {},
    id: 'gpt-5.4-mini',
    providerId: 'lobehub',
    type: 'chat',
  },
] as Awaited<ReturnType<typeof loadModels>>;

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn(async () => availableModels),
}));

vi.mock('@lobechat/business-model-runtime', () => ({
  resolveBusinessModelMapping: vi.fn(async (_provider: string, model: string) => ({
    resolvedModelId: model,
  })),
}));

describe('resolveSystemAgentModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadModels).mockResolvedValue(availableModels);
    vi.mocked(resolveBusinessModelMapping).mockImplementation(async (_provider, model) => ({
      resolvedModelId: model,
    }));
  });

  it('should keep an available LobeHub chat model when no mapping matches', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'deepseek-v4-pro',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });
    expect(resolveBusinessModelMapping).toHaveBeenCalledWith('lobehub', 'deepseek-v4-pro');
  });

  it('should resolve model mapping before checking LobeHub model availability', async () => {
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'deepseek-v4-pro',
      resolvedModelId: 'gpt-5.4-mini',
    });

    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'deepseek-v4-pro',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'gpt-5.4-mini', provider: 'lobehub' });
  });

  it('should use mapped model id when a LobeHub alias resolves to an available chat model', async () => {
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'mapped-topic-model',
      resolvedModelId: 'deepseek-v4-pro',
    });

    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'mapped-topic-model',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });
  });

  it('should fall back to task defaults for an unavailable LobeHub chat model', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'ag/gemini-3.1-pro-high',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual(DEFAULT_SYSTEM_AGENT_CONFIG.topic);
  });

  it('should keep non-LobeHub provider model ids untouched', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'private-model',
        provider: 'openai-compatible',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'private-model', provider: 'openai-compatible' });
    expect(resolveBusinessModelMapping).not.toHaveBeenCalled();
  });
});
