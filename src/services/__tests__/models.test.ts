import type * as FetchSSE from '@lobechat/fetch-sse';
import { getMessageError } from '@lobechat/fetch-sse';
import { type Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiProviderSelectors } from '@/store/aiInfra';

import { createHeaderWithAuth } from '../_auth';
import { resolveRuntimeProvider } from '../chat/helper';
import { initializeWithClientStore } from '../chat/mecha';
import { ModelsService } from '../models';

vi.stubGlobal('fetch', vi.fn());

vi.mock('@lobechat/fetch-sse', async () => {
  const actual = (await vi.importActual('@lobechat/fetch-sse')) as typeof FetchSSE;

  return {
    ...actual,
    getMessageError: vi.fn(actual.getMessageError),
  };
});

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('../_auth', () => ({
  createHeaderWithAuth: vi.fn(async () => ({})),
}));

vi.mock('../chat/helper', () => ({
  resolveRuntimeProvider: vi.fn((provider: string) => provider),
}));

vi.mock('../chat/mecha', () => ({
  initializeWithClientStore: vi.fn(),
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isProviderFetchOnClient: () => () => false,
  },
  getAiInfraStoreState: () => ({}),
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  modelConfigSelectors: {
    isProviderFetchOnClient: () => () => false,
  },
}));

// 创建一个测试用的 ModelsService 实例
const modelsService = new ModelsService();

const mockedCreateHeaderWithAuth = vi.mocked(createHeaderWithAuth);
const mockedGetMessageError = vi.mocked(getMessageError);
const mockedResolveRuntimeProvider = vi.mocked(resolveRuntimeProvider);
const mockedInitializeWithClientStore = vi.mocked(initializeWithClientStore);

describe('ModelsService', () => {
  beforeEach(() => {
    (fetch as Mock).mockClear();
    mockedCreateHeaderWithAuth.mockClear();
    mockedGetMessageError.mockClear();
    mockedResolveRuntimeProvider.mockReset();
    mockedResolveRuntimeProvider.mockImplementation((provider: string) => provider);
    mockedInitializeWithClientStore.mockClear();
  });

  describe('getModels', () => {
    it('should call the endpoint for runtime provider when server fetching', async () => {
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );

      await modelsService.getModels('openai');

      expect(mockedResolveRuntimeProvider).toHaveBeenCalledWith('openai');
      expect(fetch).toHaveBeenCalledWith('/webapi/models/openai', { headers: {} });
      expect(mockedInitializeWithClientStore).not.toHaveBeenCalled();
    });

    it('should map custom provider to runtime provider endpoint', async () => {
      mockedResolveRuntimeProvider.mockImplementation(() => 'openai');
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );

      await modelsService.getModels('custom-provider');

      expect(mockedResolveRuntimeProvider).toHaveBeenCalledWith('custom-provider');
      // API endpoint uses original provider, allowing server to query correct config
      expect(fetch).toHaveBeenCalledWith('/webapi/models/custom-provider', { headers: {} });
      expect(mockedInitializeWithClientStore).not.toHaveBeenCalled();
    });

    it('should fetch models on client when isProviderFetchOnClient is true', async () => {
      // Mock isProviderFetchOnClient to return true
      const spyIsClient = vi
        .spyOn(aiProviderSelectors, 'isProviderFetchOnClient')
        .mockReturnValue(() => true);
      // Mock initializeWithClientStore to return a runtime with a models() method
      const mockModels = vi.fn().mockResolvedValue({ models: ['model1', 'model2'] });
      mockedInitializeWithClientStore.mockResolvedValue({ models: mockModels } as any);

      const result = await modelsService.getModels('openai');

      expect(spyIsClient).toHaveBeenCalledWith('openai');
      expect(mockedInitializeWithClientStore).toHaveBeenCalledWith({
        provider: 'openai',
        runtimeProvider: 'openai',
      });
      expect(mockModels).toHaveBeenCalled();
      expect(result).toEqual({ models: ['model1', 'model2'] });

      spyIsClient.mockRestore();
    });

    it('should throw model fetch error details when server response is not ok', async () => {
      (fetch as Mock).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            body: {
              error: {
                message: 'Cloudflare models API returned an invalid response',
                name: 'Error',
              },
              message: 'Cloudflare models API returned an invalid response',
              provider: 'cloudflare',
            },
            errorType: 'ProviderBizError',
          }),
          { status: 471 },
        ),
      );

      await expect(modelsService.getModels('cloudflare')).rejects.toThrow(
        'Cloudflare models API returned an invalid response',
      );
    });

    it('should fall back to translated error message when server error body has no message', async () => {
      mockedGetMessageError.mockResolvedValueOnce({
        body: {
          provider: 'cloudflare',
        },
        message: 'fallback model fetch failure',
        type: 'ProviderBizError',
      });
      (fetch as Mock).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            body: {
              provider: 'cloudflare',
            },
            errorType: 'ProviderBizError',
          }),
          { status: 471 },
        ),
      );

      await expect(modelsService.getModels('cloudflare')).rejects.toThrow(
        'fallback model fetch failure',
      );
    });

    it('should propagate server fetch network errors', async () => {
      (fetch as Mock).mockRejectedValueOnce(new Error('network down'));

      await expect(modelsService.getModels('openai')).rejects.toThrow('network down');
    });

    it('should propagate client runtime model fetch errors', async () => {
      const spyIsClient = vi
        .spyOn(aiProviderSelectors, 'isProviderFetchOnClient')
        .mockReturnValue(() => true);
      const mockModels = vi.fn().mockRejectedValue(new Error('client runtime failed'));
      mockedInitializeWithClientStore.mockResolvedValue({ models: mockModels } as any);

      await expect(modelsService.getModels('openai')).rejects.toThrow('client runtime failed');

      spyIsClient.mockRestore();
    });
  });
});
