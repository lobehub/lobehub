import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from './discover';

// Mock dependencies
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      getAssistantCategories: {
        query: vi.fn(),
      },
      getAssistantDetail: {
        query: vi.fn(),
      },
      getAssistantIdentifiers: {
        query: vi.fn(),
      },
      getAssistantList: {
        query: vi.fn(),
      },
      getMcpCategories: {
        query: vi.fn(),
      },
      getMcpDetail: {
        query: vi.fn(),
      },
      getMcpList: {
        query: vi.fn(),
      },
      getMcpManifest: {
        query: vi.fn(),
      },
      getModelCategories: {
        query: vi.fn(),
      },
      getModelDetail: {
        query: vi.fn(),
      },
      getModelIdentifiers: {
        query: vi.fn(),
      },
      getModelList: {
        query: vi.fn(),
      },
      getPluginCategories: {
        query: vi.fn(),
      },
      getPluginDetail: {
        query: vi.fn(),
      },
      getPluginIdentifiers: {
        query: vi.fn(),
      },
      getPluginList: {
        query: vi.fn(),
      },
      getProviderDetail: {
        query: vi.fn(),
      },
      getProviderIdentifiers: {
        query: vi.fn(),
      },
      getProviderList: {
        query: vi.fn(),
      },
      registerClientInMarketplace: {
        mutate: vi.fn(),
      },
      registerM2MToken: {
        query: vi.fn(),
      },
      reportMcpInstallResult: {
        mutate: vi.fn(),
      },
      reportCall: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('@/store/global/helpers', () => ({
  globalHelpers: {
    getCurrentLanguage: vi.fn(() => 'en-US'),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(() => ({})),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    userAllowTrace: vi.fn(() => true),
  },
}));

vi.mock('@/utils/object', () => ({
  cleanObject: vi.fn((obj) => obj),
}));

describe('DiscoverService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset localStorage
    global.localStorage = {
      getItem: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    } as any;
    // Reset document.cookie
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: '',
    });
  });

  describe('Assistant Market', () => {
    describe('getAssistantCategories', () => {
      it('should fetch assistant categories with locale', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockCategories: any = [
          { id: '1', name: 'Category 1', category: 'test', count: 10 },
          { id: '2', name: 'Category 2', category: 'test2', count: 5 },
        ];

        vi.mocked(lambdaClient.market.getAssistantCategories.query).mockResolvedValue(
          mockCategories,
        );

        const result = await discoverService.getAssistantCategories();

        expect(result).toEqual(mockCategories);
        expect(lambdaClient.market.getAssistantCategories.query).toHaveBeenCalledWith({
          locale: 'en-US',
          source: undefined,
        });
      });

      it('should pass source parameter when provided', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockCategories: any = [{ id: '1', name: 'Category', category: 'test', count: 3 }];

        vi.mocked(lambdaClient.market.getAssistantCategories.query).mockResolvedValue(
          mockCategories,
        );

        await discoverService.getAssistantCategories({ source: 'legacy' });

        expect(lambdaClient.market.getAssistantCategories.query).toHaveBeenCalledWith({
          locale: 'en-US',
          source: 'legacy',
        });
      });
    });

    describe('getAssistantDetail', () => {
      it('should fetch assistant detail with identifier', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockDetail: any = {
          identifier: 'test-assistant',
          meta: { title: 'Test Assistant' },
          related: [],
          author: 'test',
          createdAt: '2024-01-01',
        };

        vi.mocked(lambdaClient.market.getAssistantDetail.query).mockResolvedValue(mockDetail);

        const result = await discoverService.getAssistantDetail({ identifier: 'test-assistant' });

        expect(result).toEqual(mockDetail);
        expect(lambdaClient.market.getAssistantDetail.query).toHaveBeenCalledWith({
          identifier: 'test-assistant',
          locale: 'en-US',
          source: undefined,
          version: undefined,
        });
      });

      it('should pass version and source when provided', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockDetail: any = {
          identifier: 'test',
          meta: { title: 'Test' },
          related: [],
          author: 'test',
          createdAt: '2024-01-01',
        };

        vi.mocked(lambdaClient.market.getAssistantDetail.query).mockResolvedValue(mockDetail);

        await discoverService.getAssistantDetail({
          identifier: 'test',
          version: '1.0.0',
          source: 'legacy',
        });

        expect(lambdaClient.market.getAssistantDetail.query).toHaveBeenCalledWith({
          identifier: 'test',
          locale: 'en-US',
          source: 'legacy',
          version: '1.0.0',
        });
      });
    });

    describe('getAssistantList', () => {
      it('should fetch assistant list with default pagination', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockList: any = {
          items: [],
          currentPage: 1,
          pageSize: 20,
          totalCount: 0,
          totalPages: 0,
        };

        vi.mocked(lambdaClient.market.getAssistantList.query).mockResolvedValue(mockList);

        const result = await discoverService.getAssistantList();

        expect(result).toEqual(mockList);
        expect(lambdaClient.market.getAssistantList.query).toHaveBeenCalledWith(
          {
            locale: 'en-US',
            page: 1,
            pageSize: 20,
          },
          { context: { showNotification: false } },
        );
      });

      it('should use custom page and pageSize', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockList: any = {
          items: [],
          currentPage: 3,
          pageSize: 50,
          totalCount: 0,
          totalPages: 0,
        };

        vi.mocked(lambdaClient.market.getAssistantList.query).mockResolvedValue(mockList);

        await discoverService.getAssistantList({ page: 3, pageSize: 50 });

        expect(lambdaClient.market.getAssistantList.query).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 3,
            pageSize: 50,
          }),
          { context: { showNotification: false } },
        );
      });
    });
  });

  describe('MCP Market', () => {
    describe('getMCPPluginList', () => {
      it('should inject token before fetching MCP plugin list', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockList: any = {
          items: [],
          currentPage: 1,
          pageSize: 21,
          totalCount: 0,
          totalPages: 0,
        };

        // Mock cookie to indicate token is active
        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active',
          writable: true,
          configurable: true,
        });

        vi.mocked(lambdaClient.market.getMcpList.query).mockResolvedValue(mockList);

        const result = await discoverService.getMCPPluginList({ page: 1 });

        expect(result).toEqual(mockList);
        expect(lambdaClient.market.getMcpList.query).toHaveBeenCalledWith({
          locale: 'en-US',
          page: 1,
          pageSize: 21,
        });
      });
    });

    describe('getMCPPluginManifest', () => {
      it('should fetch MCP plugin manifest', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockManifest: any = {
          identifier: 'test-plugin',
          version: '1.0.0',
          meta: { title: 'Test Plugin' },
        };

        vi.mocked(lambdaClient.market.getMcpManifest.query).mockResolvedValue(mockManifest);

        const result = await discoverService.getMCPPluginManifest('test-plugin');

        expect(result).toEqual(mockManifest);
        expect(lambdaClient.market.getMcpManifest.query).toHaveBeenCalledWith({
          identifier: 'test-plugin',
          install: undefined,
          locale: 'en-US',
        });
      });

      it('should pass install option when provided', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockManifest: any = {
          identifier: 'test',
          version: '1.0.0',
          meta: { title: 'Test' },
        };

        vi.mocked(lambdaClient.market.getMcpManifest.query).mockResolvedValue(mockManifest);

        await discoverService.getMCPPluginManifest('test-plugin', { install: true });

        expect(lambdaClient.market.getMcpManifest.query).toHaveBeenCalledWith({
          identifier: 'test-plugin',
          install: true,
          locale: 'en-US',
        });
      });
    });

    describe('reportMcpInstallResult', () => {
      it('should report successful MCP installation when user allows tracing', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');

        // Mock cookie to indicate token is active
        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active',
          writable: true,
          configurable: true,
        });

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(true);
        vi.mocked(lambdaClient.market.reportMcpInstallResult.mutate).mockResolvedValue({
          success: true,
        });

        await discoverService.reportMcpInstallResult({
          identifier: 'test-plugin',
          version: '1.0.0',
          success: true,
          manifest: { prompts: [], resources: [], tools: [] } as any,
        });

        expect(lambdaClient.market.reportMcpInstallResult.mutate).toHaveBeenCalledWith({
          identifier: 'test-plugin',
          manifest: { prompts: [], resources: [], tools: [] },
          success: true,
          version: '1.0.0',
        });
      });

      it('should report failed installation with error details', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');

        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active',
          writable: true,
          configurable: true,
        });

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(true);
        vi.mocked(lambdaClient.market.reportMcpInstallResult.mutate).mockResolvedValue({
          success: true,
        });

        await discoverService.reportMcpInstallResult({
          identifier: 'test-plugin',
          version: '1.0.0',
          success: false,
          errorCode: 'INSTALL_FAILED',
          errorMessage: 'Installation failed',
        });

        expect(lambdaClient.market.reportMcpInstallResult.mutate).toHaveBeenCalledWith({
          errorCode: 'INSTALL_FAILED',
          errorMessage: 'Installation failed',
          identifier: 'test-plugin',
          success: false,
          version: '1.0.0',
        });
      });

      it('should not report when user disallows tracing', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(false);

        await discoverService.reportMcpInstallResult({
          identifier: 'test-plugin',
          version: '1.0.0',
          success: true,
        });

        expect(lambdaClient.market.reportMcpInstallResult.mutate).not.toHaveBeenCalled();
      });

      it('should handle report errors gracefully', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active',
          writable: true,
          configurable: true,
        });

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(true);
        vi.mocked(lambdaClient.market.reportMcpInstallResult.mutate).mockRejectedValue(
          new Error('Network error'),
        );

        await discoverService.reportMcpInstallResult({
          identifier: 'test-plugin',
          version: '1.0.0',
          success: true,
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Failed to report MCP installation result:',
          expect.any(Error),
        );

        consoleWarnSpy.mockRestore();
      });
    });

    describe('reportPluginCall', () => {
      it('should report plugin call when user allows tracing', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');

        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active',
          writable: true,
          configurable: true,
        });

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(true);
        vi.mocked(lambdaClient.market.reportCall.mutate).mockResolvedValue({ success: true });

        await discoverService.reportPluginCall({
          identifier: 'test-plugin',
          methodName: 'testMethod',
          methodType: 'tool',
          version: '1.0.0',
          callDurationMs: 100,
          success: true,
          isCustomPlugin: false,
        });

        expect(lambdaClient.market.reportCall.mutate).toHaveBeenCalledWith({
          callDurationMs: 100,
          identifier: 'test-plugin',
          isCustomPlugin: false,
          methodName: 'testMethod',
          methodType: 'tool',
          success: true,
          version: '1.0.0',
        });
      });

      it('should not report when user disallows tracing', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(false);

        await discoverService.reportPluginCall({
          identifier: 'test-plugin',
          methodName: 'testMethod',
          methodType: 'tool',
          version: '1.0.0',
          callDurationMs: 100,
          success: true,
          isCustomPlugin: false,
        });

        expect(lambdaClient.market.reportCall.mutate).not.toHaveBeenCalled();
      });

      it('should handle report errors gracefully', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const { preferenceSelectors } = await import('@/store/user/selectors');
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active',
          writable: true,
          configurable: true,
        });

        vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(true);
        vi.mocked(lambdaClient.market.reportCall.mutate).mockRejectedValue(
          new Error('Report failed'),
        );

        await discoverService.reportPluginCall({
          identifier: 'test-plugin',
          methodName: 'testMethod',
          methodType: 'tool',
          version: '1.0.0',
          callDurationMs: 100,
          success: false,
          isCustomPlugin: true,
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to report call:', expect.any(Error));

        consoleWarnSpy.mockRestore();
      });
    });
  });

  describe('Model Market', () => {
    describe('getModelList', () => {
      it('should fetch model list with default pagination', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockList: any = {
          items: [],
          currentPage: 1,
          pageSize: 20,
          totalCount: 0,
          totalPages: 0,
        };

        vi.mocked(lambdaClient.market.getModelList.query).mockResolvedValue(mockList);

        const result = await discoverService.getModelList();

        expect(result).toEqual(mockList);
        expect(lambdaClient.market.getModelList.query).toHaveBeenCalledWith({
          locale: 'en-US',
          page: 1,
          pageSize: 20,
        });
      });

      it('should handle custom pagination parameters', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockList: any = {
          items: [],
          currentPage: 2,
          pageSize: 50,
          totalCount: 100,
          totalPages: 2,
        };

        vi.mocked(lambdaClient.market.getModelList.query).mockResolvedValue(mockList);

        await discoverService.getModelList({ page: 2, pageSize: 50 });

        expect(lambdaClient.market.getModelList.query).toHaveBeenCalledWith({
          locale: 'en-US',
          page: 2,
          pageSize: 50,
        });
      });
    });
  });

  describe('Plugin Market', () => {
    describe('getPluginList', () => {
      it('should fetch plugin list with locale', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockList: any = {
          items: [],
          currentPage: 1,
          pageSize: 20,
          totalCount: 0,
          totalPages: 0,
        };

        vi.mocked(lambdaClient.market.getPluginList.query).mockResolvedValue(mockList);

        const result = await discoverService.getPluginList();

        expect(result).toEqual(mockList);
        expect(lambdaClient.market.getPluginList.query).toHaveBeenCalledWith({
          locale: 'en-US',
          page: 1,
          pageSize: 20,
        });
      });
    });
  });

  describe('Provider Market', () => {
    describe('getProviderDetail', () => {
      it('should fetch provider detail', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockDetail: any = {
          identifier: 'openai',
          meta: { title: 'OpenAI' },
          models: [],
          related: [],
        };

        vi.mocked(lambdaClient.market.getProviderDetail.query).mockResolvedValue(mockDetail);

        const result = await discoverService.getProviderDetail({ identifier: 'openai' });

        expect(result).toEqual(mockDetail);
        expect(lambdaClient.market.getProviderDetail.query).toHaveBeenCalledWith({
          identifier: 'openai',
          locale: 'en-US',
          withReadme: undefined,
        });
      });

      it('should pass withReadme parameter', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const mockDetail: any = {
          identifier: 'openai',
          meta: { title: 'OpenAI' },
          models: [],
          related: [],
        };

        vi.mocked(lambdaClient.market.getProviderDetail.query).mockResolvedValue(mockDetail);

        await discoverService.getProviderDetail({ identifier: 'openai', withReadme: true });

        expect(lambdaClient.market.getProviderDetail.query).toHaveBeenCalledWith({
          identifier: 'openai',
          locale: 'en-US',
          withReadme: true,
        });
      });
    });
  });

  describe('Token Management', () => {
    describe('injectMPToken', () => {
      it('should skip injection if localStorage is undefined', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');

        // @ts-expect-error - testing undefined scenario
        global.localStorage = undefined;

        await discoverService.injectMPToken();

        expect(lambdaClient.market.registerClientInMarketplace.mutate).not.toHaveBeenCalled();
      });

      it('should skip injection if token status cookie is active', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');

        Object.defineProperty(document, 'cookie', {
          value: 'mp_token_status=active; other=value',
          writable: true,
        });

        await discoverService.injectMPToken();

        expect(lambdaClient.market.registerClientInMarketplace.mutate).not.toHaveBeenCalled();
      });

      it('should register new client when localStorage is empty', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');

        vi.mocked(global.localStorage.getItem).mockReturnValue(null);
        vi.mocked(lambdaClient.market.registerClientInMarketplace.mutate).mockResolvedValue({
          clientId: 'new-client-id',
          clientSecret: 'new-client-secret',
        });
        vi.mocked(lambdaClient.market.registerM2MToken.query).mockResolvedValue({
          success: true,
        });

        await discoverService.injectMPToken();

        expect(lambdaClient.market.registerClientInMarketplace.mutate).toHaveBeenCalled();
        expect(global.localStorage.setItem).toHaveBeenCalledWith(
          '_mpc',
          expect.any(String), // base64 encoded
        );
        expect(lambdaClient.market.registerM2MToken.query).toHaveBeenCalledWith({
          clientId: 'new-client-id',
          clientSecret: 'new-client-secret',
        });
      });

      it('should use existing client credentials from localStorage', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const clientData = { clientId: 'existing-id', clientSecret: 'existing-secret' };
        const encodedData = btoa(JSON.stringify(clientData));

        vi.mocked(global.localStorage.getItem).mockReturnValue(encodedData);
        vi.mocked(lambdaClient.market.registerM2MToken.query).mockResolvedValue({
          success: true,
        });

        await discoverService.injectMPToken();

        expect(lambdaClient.market.registerClientInMarketplace.mutate).not.toHaveBeenCalled();
        expect(lambdaClient.market.registerM2MToken.query).toHaveBeenCalledWith({
          clientId: 'existing-id',
          clientSecret: 'existing-secret',
        });
      });

      it('should re-register when decoding fails', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.mocked(global.localStorage.getItem).mockReturnValue('invalid-base64!!!');
        vi.mocked(lambdaClient.market.registerClientInMarketplace.mutate).mockResolvedValue({
          clientId: 'new-id',
          clientSecret: 'new-secret',
        });
        vi.mocked(lambdaClient.market.registerM2MToken.query).mockResolvedValue({
          success: true,
        });

        await discoverService.injectMPToken();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to decode client data:',
          expect.any(Error),
        );
        expect(lambdaClient.market.registerClientInMarketplace.mutate).toHaveBeenCalled();
        expect(global.localStorage.setItem).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
      });

      it('should retry once when token registration fails', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const clientData = { clientId: 'invalid-id', clientSecret: 'invalid-secret' };
        const encodedData = btoa(JSON.stringify(clientData));

        vi.mocked(global.localStorage.getItem)
          .mockReturnValueOnce(encodedData)
          .mockReturnValueOnce(null);

        vi.mocked(lambdaClient.market.registerM2MToken.query)
          .mockResolvedValueOnce({ success: false })
          .mockResolvedValueOnce({ success: true });

        vi.mocked(lambdaClient.market.registerClientInMarketplace.mutate).mockResolvedValue({
          clientId: 'retry-id',
          clientSecret: 'retry-secret',
        });

        await discoverService.injectMPToken();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Token registration failed, client credentials may be invalid. Clearing and retrying...',
        );
        expect(global.localStorage.removeItem).toHaveBeenCalledWith('_mpc');
        expect(lambdaClient.market.registerClientInMarketplace.mutate).toHaveBeenCalled();

        consoleWarnSpy.mockRestore();
      });

      it('should not retry more than once', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const clientData = { clientId: 'invalid-id', clientSecret: 'invalid-secret' };
        const encodedData = btoa(JSON.stringify(clientData));

        vi.mocked(global.localStorage.getItem)
          .mockReturnValueOnce(encodedData)
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null);

        vi.mocked(lambdaClient.market.registerM2MToken.query).mockResolvedValue({
          success: false,
        });

        vi.mocked(lambdaClient.market.registerClientInMarketplace.mutate).mockResolvedValue({
          clientId: 'new-id',
          clientSecret: 'new-secret',
        });

        await discoverService.injectMPToken();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to re-register after credential invalidation',
        );

        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      });

      it('should handle M2M token registration errors', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const clientData = { clientId: 'test-id', clientSecret: 'test-secret' };
        const encodedData = btoa(JSON.stringify(clientData));

        vi.mocked(global.localStorage.getItem).mockReturnValue(encodedData);
        vi.mocked(lambdaClient.market.registerM2MToken.query).mockRejectedValue(
          new Error('Network error'),
        );

        const result = await discoverService.injectMPToken();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to register M2M token:',
          expect.any(Error),
        );
        expect(result).toBeNull();

        consoleErrorSpy.mockRestore();
      });
    });

    describe('getTokenStatusFromCookie', () => {
      it('should parse token status from cookie correctly', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');

        Object.defineProperty(document, 'cookie', {
          value: 'other=value; mp_token_status=active; another=cookie',
          writable: true,
          configurable: true,
        });

        await discoverService.injectMPToken();

        expect(lambdaClient.market.registerClientInMarketplace.mutate).not.toHaveBeenCalled();
      });

      it('should return null when token status cookie is not found', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');

        Object.defineProperty(document, 'cookie', {
          value: 'other=value; session=abc123',
          writable: true,
          configurable: true,
        });

        vi.mocked(global.localStorage.getItem).mockReturnValue(null);
        vi.mocked(lambdaClient.market.registerClientInMarketplace.mutate).mockResolvedValue({
          clientId: 'id',
          clientSecret: 'secret',
        });
        vi.mocked(lambdaClient.market.registerM2MToken.query).mockResolvedValue({
          success: true,
        });

        await discoverService.injectMPToken();

        // Should proceed with registration since token status is not active
        expect(lambdaClient.market.registerClientInMarketplace.mutate).toHaveBeenCalled();
      });
    });
  });
});
