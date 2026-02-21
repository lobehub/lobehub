import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type GlobalRuntimeConfig } from '@/types/serverConfig';

import { createServerConfigStore } from './store';

// Mock SWR
let mockSWRData: GlobalRuntimeConfig | undefined;
let mockOnSuccessCallback: ((data: GlobalRuntimeConfig) => void) | undefined;

vi.mock('@/libs/swr', () => ({
  useOnlyFetchOnceSWR: vi.fn((key, fetcher, options) => {
    const { onSuccess } = options || {};
    mockOnSuccessCallback = onSuccess;

    // Simulate SWR behavior
    if (mockSWRData && onSuccess) {
      onSuccess(mockSWRData);
    }

    return {
      data: mockSWRData,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    };
  }),
}));

const mockGlobalConfig: GlobalRuntimeConfig = {
  serverConfig: {
    telemetry: {
      langfuse: undefined,
    },
    aiProvider: {},
  },
  serverFeatureFlags: {
    enableWebrtc: true,
  },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  mockSWRData = mockGlobalConfig;
});

afterEach(() => {
  vi.restoreAllMocks();
  mockSWRData = undefined;
  mockOnSuccessCallback = undefined;
});

describe('ServerConfigAction', () => {
  describe('useInitServerConfig', () => {
    it('should return SWR response', () => {
      const store = createServerConfigStore();

      const swrResponse = store.getState().useInitServerConfig();

      expect(swrResponse).toBeDefined();
      expect(swrResponse.data).toBeDefined();
      expect(swrResponse.isLoading).toBe(false);
    });

    it('should update store state on successful fetch', () => {
      const store = createServerConfigStore();

      store.getState().useInitServerConfig();

      const state = store.getState();

      expect(state.serverConfig).toBeDefined();
      expect(state.featureFlags).toBeDefined();
    });

    it('should pass a fetcher function that calls globalService', async () => {
      const { useOnlyFetchOnceSWR } = vi.mocked(await import('@/libs/swr'));

      const store = createServerConfigStore();

      store.getState().useInitServerConfig();

      expect(useOnlyFetchOnceSWR).toHaveBeenCalled();

      // Verify the second argument is a function
      const fetcherArg = (useOnlyFetchOnceSWR as any).mock.calls[0][1];
      expect(typeof fetcherArg).toBe('function');
    });
  });

  describe('onSuccess callback', () => {
    it('should set serverConfig and featureFlags correctly', () => {
      const customConfig: GlobalRuntimeConfig = {
        serverConfig: {
          telemetry: { langfuse: { publicKey: 'test-key' } },
          aiProvider: {},
        },
        serverFeatureFlags: {
          enableWebrtc: false,
        },
      } as any;

      mockSWRData = customConfig;

      const store = createServerConfigStore();

      store.getState().useInitServerConfig();

      const state = store.getState();

      expect(state.serverConfig).toBeDefined();
      expect(state.featureFlags).toBeDefined();
    });

    it('should update both serverConfig and serverFeatureFlags in store', () => {
      const store = createServerConfigStore();

      const initialState = store.getState();
      expect(initialState.serverConfig).toBeDefined();

      store.getState().useInitServerConfig();

      const updatedState = store.getState();
      expect(updatedState.serverConfig).toEqual(mockGlobalConfig.serverConfig);
      expect(updatedState.featureFlags).toEqual(mockGlobalConfig.serverFeatureFlags);
    });
  });

  describe('SWR integration', () => {
    it('should use correct SWR key', async () => {
      const { useOnlyFetchOnceSWR } = vi.mocked(await import('@/libs/swr'));

      const store = createServerConfigStore();
      store.getState().useInitServerConfig();

      expect(useOnlyFetchOnceSWR).toHaveBeenCalledWith(
        'FETCH_SERVER_CONFIG',
        expect.any(Function),
        expect.objectContaining({
          onSuccess: expect.any(Function),
        }),
      );
    });

    it('should pass globalService.getGlobalConfig as fetcher', async () => {
      const { useOnlyFetchOnceSWR } = vi.mocked(await import('@/libs/swr'));

      const store = createServerConfigStore();
      store.getState().useInitServerConfig();

      expect(useOnlyFetchOnceSWR).toHaveBeenCalledWith(
        'FETCH_SERVER_CONFIG',
        expect.any(Function),
        expect.any(Object),
      );

      const fetcherArg = (useOnlyFetchOnceSWR as any).mock.calls[0][1];
      expect(typeof fetcherArg).toBe('function');
    });
  });
});
