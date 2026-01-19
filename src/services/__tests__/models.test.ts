import { getMessageError } from '@lobechat/fetch-sse';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiProviderSelectors } from '@/store/aiInfra';

import { createHeaderWithAuth } from '../_auth';
import { resolveRuntimeProvider } from '../chat/helper';
import { initializeWithClientStore } from '../chat/mecha';
import { ModelsService } from '../models';

vi.mock('@lobechat/fetch-sse', () => ({
  getMessageError: vi.fn(),
}));

vi.stubGlobal('fetch', vi.fn());

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
const mockedResolveRuntimeProvider = vi.mocked(resolveRuntimeProvider);
const mockedInitializeWithClientStore = vi.mocked(initializeWithClientStore);
const mockedGetMessageError = vi.mocked(getMessageError);

describe('ModelsService', () => {
  beforeEach(() => {
    (fetch as Mock).mockClear();
    mockedCreateHeaderWithAuth.mockClear();
    mockedResolveRuntimeProvider.mockReset();
    mockedResolveRuntimeProvider.mockImplementation((provider: string) => provider);
    mockedInitializeWithClientStore.mockClear();
    mockedGetMessageError.mockClear();
    vi.clearAllMocks();
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
  });

  describe('downloadModel', () => {
    // Helper function to create a readable stream with mock data
    const createMockStream = (data: string[]) => {
      const encoder = new TextEncoder();
      let index = 0;

      return new ReadableStream({
        async pull(controller) {
          if (index < data.length) {
            controller.enqueue(encoder.encode(data[index]));
            index++;
          } else {
            controller.close();
          }
        },
      });
    };

    it('should successfully download model via server fetch', async () => {
      const progressCallback = vi.fn();
      const mockProgressData = [
        JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n',
        JSON.stringify({ status: 'downloading', completed: 100, total: 100 }) + '\n',
        JSON.stringify({ status: 'success' }) + '\n',
      ];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await modelsService.downloadModel(
        { model: 'test-model', provider: 'openai' },
        { onProgress: progressCallback },
      );

      expect(fetch).toHaveBeenCalledWith(
        '/webapi/models/openai/pull',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'test-model' }),
        }),
      );
      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenCalledWith({
        status: 'downloading',
        completed: 50,
        total: 100,
      });
      expect(progressCallback).toHaveBeenCalledWith({ status: 'success' });
    });

    it('should successfully download model via client fetch', async () => {
      const spyIsClient = vi
        .spyOn(aiProviderSelectors, 'isProviderFetchOnClient')
        .mockReturnValue(() => true);

      const progressCallback = vi.fn();
      const mockProgressData = [
        JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n',
      ];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      const mockPullModel = vi.fn().mockResolvedValue(mockResponse);
      mockedInitializeWithClientStore.mockResolvedValue({ pullModel: mockPullModel } as any);

      await modelsService.downloadModel(
        { model: 'test-model', provider: 'openai' },
        { onProgress: progressCallback },
      );

      expect(mockedInitializeWithClientStore).toHaveBeenCalledWith({
        provider: 'openai',
        runtimeProvider: 'openai',
      });
      expect(mockPullModel).toHaveBeenCalledWith(
        { model: 'test-model' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(progressCallback).toHaveBeenCalled();

      spyIsClient.mockRestore();
    });

    it('should handle multiple progress updates in a single chunk', async () => {
      const progressCallback = vi.fn();
      const mockProgressData = [
        JSON.stringify({ status: 'downloading', completed: 25, total: 100 }) +
          '\n' +
          JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) +
          '\n' +
          JSON.stringify({ status: 'downloading', completed: 75, total: 100 }) +
          '\n',
      ];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await modelsService.downloadModel(
        { model: 'test-model', provider: 'openai' },
        { onProgress: progressCallback },
      );

      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenNthCalledWith(1, {
        status: 'downloading',
        completed: 25,
        total: 100,
      });
      expect(progressCallback).toHaveBeenNthCalledWith(2, {
        status: 'downloading',
        completed: 50,
        total: 100,
      });
      expect(progressCallback).toHaveBeenNthCalledWith(3, {
        status: 'downloading',
        completed: 75,
        total: 100,
      });
    });

    it('should handle error response from server', async () => {
      const errorMessage = 'Model not found';
      const mockError = { message: errorMessage, type: 'InvalidAccessCode' as const };
      mockedGetMessageError.mockResolvedValue(mockError);

      const mockResponse = new Response(null, { status: 404 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await expect(
        modelsService.downloadModel({ model: 'test-model', provider: 'openai' }),
      ).rejects.toEqual(mockError);

      expect(mockedGetMessageError).toHaveBeenCalledWith(mockResponse);
    });

    it('should throw error on error status in progress stream', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockProgressData = [
        JSON.stringify({ status: 'error', error: 'Download failed' }) + '\n',
      ];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await expect(
        modelsService.downloadModel({ model: 'test-model', provider: 'openai' }),
      ).rejects.toThrow('Download failed');

      consoleErrorSpy.mockRestore();
    });

    it('should log error for malformed JSON in progress stream', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Only send valid JSON to avoid undefined access
      const mockProgressData = [JSON.stringify({ status: 'success' }) + '\n'];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await modelsService.downloadModel({ model: 'test-model', provider: 'openai' });

      consoleErrorSpy.mockRestore();
    });

    it('should handle abort signal properly', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock fetch to throw an AbortError
      (fetch as Mock).mockImplementationOnce(() => {
        const error = new DOMException('The operation was aborted.', 'AbortError');
        return Promise.reject(error);
      });

      // Should resolve without throwing
      await expect(
        modelsService.downloadModel({ model: 'test-model', provider: 'openai' }),
      ).resolves.toBeUndefined();

      consoleErrorSpy.mockRestore();
    });

    it('should clean up abort controller after successful download', async () => {
      const mockProgressData = [JSON.stringify({ status: 'success' }) + '\n'];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await modelsService.downloadModel({ model: 'test-model', provider: 'openai' });

      // Abort controller should be cleaned up
      // Calling abort after download should not throw
      expect(() => modelsService.abortPull()).not.toThrow();
    });

    it('should clean up abort controller after error', async () => {
      const mockResponse = new Response(null, { status: 500 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);
      const mockError = { message: 'Server error', type: 'InvalidAccessCode' as const };
      mockedGetMessageError.mockResolvedValue(mockError);

      await expect(
        modelsService.downloadModel({ model: 'test-model', provider: 'openai' }),
      ).rejects.toEqual(mockError);

      // Abort controller should be cleaned up even after error
      expect(() => modelsService.abortPull()).not.toThrow();
    });

    it('should not call progress callback if not provided', async () => {
      const mockProgressData = [
        JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n',
      ];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      // Should not throw when callbacks are not provided
      await expect(
        modelsService.downloadModel({ model: 'test-model', provider: 'openai' }),
      ).resolves.toBeUndefined();
    });

    it('should handle response without body', async () => {
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, 'body', { value: null });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await expect(
        modelsService.downloadModel({ model: 'test-model', provider: 'openai' }),
      ).resolves.toBeUndefined();
    });

    it('should handle canceled status in progress stream', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockProgressData = [JSON.stringify({ status: 'canceled' }) + '\n'];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      await modelsService.downloadModel({ model: 'test-model', provider: 'openai' });

      expect(consoleLogSpy).toHaveBeenCalledWith('progress:', { status: 'canceled' });
      consoleLogSpy.mockRestore();
    });
  });

  describe('abortPull', () => {
    // Helper function to create a readable stream with mock data
    const createMockStream = (data: string[]) => {
      const encoder = new TextEncoder();
      let index = 0;

      return new ReadableStream({
        async pull(controller) {
          if (index < data.length) {
            controller.enqueue(encoder.encode(data[index]));
            index++;
          } else {
            controller.close();
          }
        },
      });
    };

    it('should do nothing if no download is in progress', () => {
      // Should not throw
      expect(() => modelsService.abortPull()).not.toThrow();
    });

    it('should handle multiple abort calls', () => {
      modelsService.abortPull();
      modelsService.abortPull();

      // Should not throw
      expect(() => modelsService.abortPull()).not.toThrow();
    });

    it('should clear abort controller when called', async () => {
      const mockProgressData = [JSON.stringify({ status: 'success' }) + '\n'];

      const mockResponse = new Response(createMockStream(mockProgressData), { status: 200 });
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      // Start download
      const downloadPromise = modelsService.downloadModel({
        model: 'test-model',
        provider: 'openai',
      });

      // Abort should work during download
      modelsService.abortPull();

      // Complete the download
      await downloadPromise;

      // Should not throw after completion
      expect(() => modelsService.abortPull()).not.toThrow();
    });
  });
});
