import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_SETTINGS } from '@lobechat/config';
import { DEFAULT_MINI_MODEL, DEFAULT_MODEL } from '@lobechat/const';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testService } from '~test-utils';

import { AiModelService, aiModelService } from './index';

const mockLambdaClient = vi.hoisted(() => ({
  aiModel: {
    batchToggleAiModels: { mutate: vi.fn() },
    batchUpdateAiModels: { mutate: vi.fn() },
    clearModelsByProvider: { mutate: vi.fn() },
    clearRemoteModels: { mutate: vi.fn() },
    createAiModel: { mutate: vi.fn() },
    getAiModelById: { query: vi.fn() },
    getAiProviderModelList: { query: vi.fn() },
    removeAiModel: { mutate: vi.fn() },
    toggleModelEnabled: { mutate: vi.fn() },
    updateAiModel: { mutate: vi.fn() },
    updateAiModelOrder: { mutate: vi.fn() },
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: mockLambdaClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AiModelService', () => {
  testService(AiModelService);

  describe('getAiProviderModelList', () => {
    it('filters hidden runtime-only models from frontend settings lists', async () => {
      mockLambdaClient.aiModel.getAiProviderModelList.query.mockResolvedValueOnce([
        {
          displayName: 'DeepSeek V4 Pro',
          enabled: true,
          id: 'deepseek-v4-pro',
          type: 'chat',
        },
        {
          displayName: 'LobeHub Onboarding',
          enabled: true,
          id: 'lobehub-onboarding-v1',
          type: 'chat',
          visible: false,
        },
      ]);

      const result = await aiModelService.getAiProviderModelList('lobehub');

      expect(mockLambdaClient.aiModel.getAiProviderModelList.query).toHaveBeenCalledWith({
        id: 'lobehub',
      });
      expect(result.map((model) => model.id)).toEqual(['deepseek-v4-pro']);
    });
  });
});

describe('Default model configuration', () => {
  it('DEFAULT_PROVIDER should be enabled in DEFAULT_MODEL_PROVIDER_LIST', () => {
    const match = DEFAULT_MODEL_PROVIDER_LIST.find((provider) => provider.id === DEFAULT_PROVIDER);
    expect(
      match,
      `DEFAULT_PROVIDER "${DEFAULT_PROVIDER}" not found in DEFAULT_MODEL_PROVIDER_LIST`,
    ).toBeDefined();
    expect(match!.enabled, `DEFAULT_PROVIDER "${DEFAULT_PROVIDER}" is not enabled`).toBe(true);
  });

  it('DEFAULT_PROVIDER should be enabled in DEFAULT_SETTINGS language model config', () => {
    const match = DEFAULT_SETTINGS.languageModel[DEFAULT_PROVIDER];
    expect(
      match,
      `DEFAULT_PROVIDER "${DEFAULT_PROVIDER}" not found in DEFAULT_SETTINGS language model config`,
    ).toBeDefined();
    expect(match!.enabled, `DEFAULT_PROVIDER "${DEFAULT_PROVIDER}" is not enabled`).toBe(true);
  });

  it('DEFAULT_MODEL should be enabled in LOBE_DEFAULT_MODEL_LIST', () => {
    const match = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.id === DEFAULT_MODEL && m.providerId === DEFAULT_PROVIDER,
    );
    expect(
      match,
      `DEFAULT_MODEL "${DEFAULT_PROVIDER}/${DEFAULT_MODEL}" not found in LOBE_DEFAULT_MODEL_LIST`,
    ).toBeDefined();
    expect(
      match!.enabled,
      `DEFAULT_MODEL "${DEFAULT_PROVIDER}/${DEFAULT_MODEL}" is not enabled`,
    ).toBe(true);
  });

  it('DEFAULT_MINI_MODEL should be enabled in LOBE_DEFAULT_MODEL_LIST', () => {
    const match = LOBE_DEFAULT_MODEL_LIST.find((m) => m.id === DEFAULT_MINI_MODEL);
    expect(
      match,
      `DEFAULT_MINI_MODEL "${DEFAULT_MINI_MODEL}" not found in LOBE_DEFAULT_MODEL_LIST`,
    ).toBeDefined();
    expect(match!.enabled, `DEFAULT_MINI_MODEL "${DEFAULT_MINI_MODEL}" is not enabled`).toBe(true);
  });
});
