import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { type PluginItem } from '@lobehub/market-sdk';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { globalHelpers } from '@/store/global/helpers';
import { type CheckMcpInstallResult } from '@/types/plugins';
import { MCPInstallStep } from '@/types/plugins';

import { useToolStore } from '../../store';

vi.mock('@/libs/trpc/client', () => ({
  asyncClient: {},
  lambdaClient: {
    market: {
      getMcpCategories: { query: vi.fn() },
      getMcpDetail: { query: vi.fn() },
      getMcpList: { query: vi.fn() },
      getMcpManifest: { query: vi.fn() },
      registerClientInMarketplace: {
        mutate: vi.fn().mockResolvedValue({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        }),
      },
      registerM2MToken: { query: vi.fn().mockResolvedValue({ success: true }) },
      reportCall: { mutate: vi.fn().mockResolvedValue(undefined) },
      reportMcpEvent: { mutate: vi.fn().mockResolvedValue(undefined) },
      reportMcpInstallResult: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
  toolsClient: {
    market: {
      callCloudMcpEndpoint: { mutate: vi.fn() },
    },
    mcp: {
      callTool: { mutate: vi.fn() },
      getStreamableMcpServerManifest: { query: vi.fn() },
    },
  },
}));

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// Mock sleep to speed up tests
vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

const ORIGINAL_DESKTOP_ENV = process.env.NEXT_PUBLIC_IS_DESKTOP_APP;

const bootstrapToolStoreWithDesktop = async (isDesktopEnv: boolean) => {
  vi.resetModules();
  vi.mock('zustand/traditional');
  process.env.NEXT_PUBLIC_IS_DESKTOP_APP = isDesktopEnv ? '1' : '0';

  vi.doMock('@lobechat/const', async () => {
    const actual = await vi.importActual<typeof import('@lobechat/const')>('@lobechat/const');
    return {
      ...actual,
      isDesktop: isDesktopEnv,
    };
  });

  const storeModule = await import('@/store/tool');
  const discoverModule = await import('@/services/discover');
  const helpersModule = await import('@/store/global/helpers');

  const cleanup = () => {
    vi.resetModules();
    vi.doUnmock('@lobechat/const');
    vi.mock('zustand/traditional');
    if (ORIGINAL_DESKTOP_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_IS_DESKTOP_APP;
    } else {
      process.env.NEXT_PUBLIC_IS_DESKTOP_APP = ORIGINAL_DESKTOP_ENV;
    }
  };

  return {
    useToolStore: storeModule.useToolStore,
    discoverService: discoverModule.discoverService,
    globalHelpers: helpersModule.globalHelpers,
    cleanup,
  };
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.spyOn(discoverService, 'injectMPToken').mockResolvedValue(undefined);
  vi.spyOn(discoverService, 'registerClient').mockResolvedValue({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  });
  vi.spyOn(discoverService, 'reportMcpEvent').mockResolvedValue(undefined as any);

  // Reset store state
  act(() => {
    useToolStore.setState(
      {
        mcpPluginItems: [],
        mcpInstallProgress: {},
        mcpInstallAbortControllers: {},
        mcpTestAbortControllers: {},
        mcpTestLoading: {},
        mcpTestErrors: {},
        currentPage: 1,
        totalCount: 0,
        categories: [],
        refreshPlugins: vi.fn(),
        updateInstallLoadingState: vi.fn(),
      },
      false,
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_DESKTOP_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_IS_DESKTOP_APP;
  } else {
    process.env.NEXT_PUBLIC_IS_DESKTOP_APP = ORIGINAL_DESKTOP_ENV;
  }
});

describe('mcpStore actions', () => {
  describe('updateMCPInstallProgress', () => {
    it('should update install progress for an identifier', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateMCPInstallProgress('test-plugin', {
          progress: 50,
          step: MCPInstallStep.GETTING_SERVER_MANIFEST,
        });
      });

      expect(result.current.mcpInstallProgress['test-plugin']).toEqual({
        progress: 50,
        step: MCPInstallStep.GETTING_SERVER_MANIFEST,
      });
    });

    it('should clear install progress when progress is undefined', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateMCPInstallProgress('test-plugin', {
          progress: 50,
          step: MCPInstallStep.INSTALLING_PLUGIN,
        });
      });

      act(() => {
        result.current.updateMCPInstallProgress('test-plugin', undefined);
      });

      expect(result.current.mcpInstallProgress['test-plugin']).toBeUndefined();
    });
  });

  describe('cancelInstallMCPPlugin', () => {
    it('should abort the installation and clear progress', async () => {
      const { result } = renderHook(() => useToolStore());
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');

      act(() => {
        useToolStore.setState({
          mcpInstallAbortControllers: { 'test-plugin': abortController },
          mcpInstallProgress: {
            'test-plugin': { progress: 50, step: MCPInstallStep.CHECKING_INSTALLATION },
          },
        });
      });

      await act(async () => {
        await result.current.cancelInstallMCPPlugin('test-plugin');
      });

      expect(abortSpy).toHaveBeenCalled();
      expect(result.current.mcpInstallAbortControllers['test-plugin']).toBeUndefined();
      expect(result.current.mcpInstallProgress['test-plugin']).toBeUndefined();
    });

    it('should handle cancel when no AbortController exists', async () => {
      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.cancelInstallMCPPlugin('non-existent-plugin');
      });

      // Should not throw error
      expect(result.current.mcpInstallAbortControllers['non-existent-plugin']).toBeUndefined();
    });
  });

  describe('cancelMcpConnectionTest', () => {
    it('should abort the connection test and clear state', () => {
      const { result } = renderHook(() => useToolStore());
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');

      act(() => {
        useToolStore.setState({
          mcpTestAbortControllers: { 'test-plugin': abortController },
          mcpTestLoading: { 'test-plugin': true },
          mcpTestErrors: { 'test-plugin': 'Some error' },
        });
      });

      act(() => {
        result.current.cancelMcpConnectionTest('test-plugin');
      });

      expect(abortSpy).toHaveBeenCalled();
      expect(result.current.mcpTestLoading['test-plugin']).toBe(false);
      expect(result.current.mcpTestAbortControllers['test-plugin']).toBeUndefined();
      expect(result.current.mcpTestErrors['test-plugin']).toBeUndefined();
    });

    it('should handle cancel when no AbortController exists', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.cancelMcpConnectionTest('non-existent-plugin');
      });

      // Should not throw error
      expect(result.current.mcpTestAbortControllers['non-existent-plugin']).toBeUndefined();
    });
  });

  describe('testMcpConnection', () => {
    const mockManifest: LobeChatPluginManifest = {
      api: [],
      gateway: '',
      identifier: 'test-plugin',
      meta: {
        avatar: 'https://example.com/avatar.png',
        description: 'Test plugin',
        title: 'Test Plugin',
      },
      type: 'standalone',
      version: '1',
    };

    describe('HTTP connection', () => {
      it('should successfully test HTTP connection', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStreamableMcpServerManifest').mockResolvedValue(mockManifest);

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'http',
              url: 'https://example.com/mcp',
            },
            metadata: {
              avatar: 'https://example.com/avatar.png',
              description: 'Test plugin',
            },
          });
        });

        expect(testResult).toEqual({
          success: true,
          manifest: mockManifest,
        });
        expect(result.current.mcpTestLoading['test-plugin']).toBe(false);
        expect(result.current.mcpTestErrors['test-plugin']).toBeUndefined();
      });

      it('should handle HTTP connection error', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStreamableMcpServerManifest').mockRejectedValue(
          new Error('Connection failed'),
        );

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'http',
              url: 'https://example.com/mcp',
            },
          });
        });

        expect(testResult).toEqual({
          success: false,
          error: 'Connection failed',
        });
        expect(result.current.mcpTestLoading['test-plugin']).toBe(false);
        expect(result.current.mcpTestErrors['test-plugin']).toBe('Connection failed');
      });

      it('should throw error when URL is missing for HTTP connection', async () => {
        const { result } = renderHook(() => useToolStore());

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'http',
            } as any,
          });
        });

        expect(testResult).toEqual({
          success: false,
          error: 'URL is required for HTTP connection',
        });
      });
    });

    describe('STDIO connection', () => {
      it('should successfully test STDIO connection', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockResolvedValue(mockManifest);

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'stdio',
              command: 'node',
              args: ['server.js'],
            },
          });
        });

        expect(testResult).toEqual({
          success: true,
          manifest: mockManifest,
        });
        expect(result.current.mcpTestLoading['test-plugin']).toBe(false);
      });

      it('should handle STDIO connection error', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockRejectedValue(
          new Error('Command not found'),
        );

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'stdio',
              command: 'invalid-command',
            },
          });
        });

        expect(testResult).toEqual({
          success: false,
          error: 'Command not found',
        });
        expect(result.current.mcpTestErrors['test-plugin']).toBe('Command not found');
      });

      it('should throw error when command is missing for STDIO connection', async () => {
        const { result } = renderHook(() => useToolStore());

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'stdio',
            } as any,
          });
        });

        expect(testResult).toEqual({
          success: false,
          error: 'Command is required for STDIO connection',
        });
      });
    });

    describe('cancellation', () => {
      it('should handle cancellation during test', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStreamableMcpServerManifest').mockImplementation(
          async (params, signal) => {
            // Simulate cancellation
            signal?.dispatchEvent(new Event('abort'));
            throw new Error('Aborted');
          },
        );

        let testResult;
        await act(async () => {
          testResult = await result.current.testMcpConnection({
            identifier: 'test-plugin',
            connection: {
              type: 'http',
              url: 'https://example.com/mcp',
            },
          });
        });

        expect(testResult).toEqual({
          success: false,
          error: 'Aborted',
        });
      });
    });

    it('should handle invalid connection type', async () => {
      const { result } = renderHook(() => useToolStore());

      let testResult;
      await act(async () => {
        testResult = await result.current.testMcpConnection({
          identifier: 'test-plugin',
          connection: {
            type: 'invalid' as any,
          },
        });
      });

      expect(testResult).toEqual({
        success: false,
        error: 'Invalid MCP connection type',
      });
    });
  });

  describe('uninstallMCPPlugin', () => {
    it('should uninstall plugin and refresh plugins', async () => {
      const { result } = renderHook(() => useToolStore());
      const uninstallSpy = vi.spyOn(pluginService, 'uninstallPlugin').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.uninstallMCPPlugin('test-plugin');
      });

      expect(uninstallSpy).toHaveBeenCalledWith('test-plugin');
      expect(result.current.refreshPlugins).toHaveBeenCalled();
    });
  });

  describe('loadMoreMCPPlugins', () => {
    it('should increment current page when more items available', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          mcpPluginItems: Array.from({ length: 10 }, (_, i) => ({
            identifier: `plugin-${i}`,
          })) as PluginItem[],
          totalCount: 50,
          currentPage: 1,
        });
      });

      act(() => {
        result.current.loadMoreMCPPlugins();
      });

      expect(result.current.currentPage).toBe(2);
    });

    it('should not increment page when all items loaded', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          mcpPluginItems: Array.from({ length: 50 }, (_, i) => ({
            identifier: `plugin-${i}`,
          })) as PluginItem[],
          totalCount: 50,
          currentPage: 5,
        });
      });

      act(() => {
        result.current.loadMoreMCPPlugins();
      });

      expect(result.current.currentPage).toBe(5);
    });
  });

  describe('resetMCPPluginList', () => {
    it('should reset plugin list and page', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          mcpPluginItems: [{ identifier: 'plugin-1' }] as PluginItem[],
          currentPage: 5,
          mcpSearchKeywords: 'old-keyword',
        });
      });

      act(() => {
        result.current.resetMCPPluginList('new-keyword');
      });

      expect(result.current.mcpPluginItems).toEqual([]);
      expect(result.current.currentPage).toBe(1);
      expect(result.current.mcpSearchKeywords).toBe('new-keyword');
    });

    it('should reset without keywords', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          mcpPluginItems: [{ identifier: 'plugin-1' }] as PluginItem[],
          currentPage: 3,
        });
      });

      act(() => {
        result.current.resetMCPPluginList();
      });

      expect(result.current.mcpPluginItems).toEqual([]);
      expect(result.current.currentPage).toBe(1);
      expect(result.current.mcpSearchKeywords).toBeUndefined();
    });
  });

  describe('useFetchMCPPluginList', () => {
    it('should fetch MCP plugin list and update state', async () => {
      const mockData = {
        items: [
          { identifier: 'plugin-1', name: 'Plugin 1' },
          { identifier: 'plugin-2', name: 'Plugin 2' },
        ] as PluginItem[],
        categories: ['category1', 'category2'],
        totalCount: 2,
        totalPages: 1,
        currentPage: 1,
        pageSize: 20,
      };

      vi.spyOn(discoverService, 'getMCPPluginList').mockResolvedValue(mockData);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const { result } = renderHook(() =>
        useToolStore.getState().useFetchMCPPluginList({ page: 1, pageSize: 20 }),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      expect(discoverService.getMCPPluginList).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 20, connectionType: 'http' }),
      );

      const state = useToolStore.getState();
      expect(state.mcpPluginItems).toEqual(mockData.items);
      expect(state.categories).toEqual(mockData.categories);
      expect(state.totalCount).toBe(2);
      expect(state.totalPages).toBe(1);
      expect(state.searchLoading).toBe(false);
    });

    it('should set active identifier on first init', async () => {
      const mockData = {
        items: [{ identifier: 'first-plugin', name: 'First Plugin' }] as PluginItem[],
        categories: [],
        totalCount: 1,
        totalPages: 1,
        currentPage: 1,
        pageSize: 20,
      };

      vi.spyOn(discoverService, 'getMCPPluginList').mockResolvedValue(mockData);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      act(() => {
        useToolStore.setState({ isMcpListInit: false });
      });

      const { result } = renderHook(() =>
        useToolStore.getState().useFetchMCPPluginList({ page: 1 }),
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      const state = useToolStore.getState();
      expect(state.activeMCPIdentifier).toBe('first-plugin');
      expect(state.isMcpListInit).toBe(true);
    });

    it('should convert page to number', async () => {
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
      vi.spyOn(discoverService, 'getMCPPluginList').mockResolvedValue({
        items: [],
        categories: [],
        totalCount: 0,
        totalPages: 0,
        currentPage: 1,
        pageSize: 20,
      });

      const params = { page: 2, pageSize: 15 } as any;
      renderHook(() => useToolStore.getState().useFetchMCPPluginList(params));

      await waitFor(() => {
        expect(discoverService.getMCPPluginList).toHaveBeenCalledWith(
          expect.objectContaining({ ...params, connectionType: 'http' }),
        );
      });
    });

    it('should include locale and parameters in SWR key', async () => {
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      vi.spyOn(discoverService, 'getMCPPluginList').mockResolvedValue({
        items: [],
        categories: [],
        totalCount: 0,
        totalPages: 0,
        currentPage: 1,
        pageSize: 20,
      });

      const params = { page: 3, pageSize: 15, q: 'test' } as any;
      renderHook(() => useToolStore.getState().useFetchMCPPluginList(params));

      await waitFor(() => {
        expect(discoverService.getMCPPluginList).toHaveBeenCalledWith(
          expect.objectContaining({ ...params, connectionType: 'http' }),
        );
      });
    });

    it('should not append connectionType in desktop environment', async () => {
      const {
        useToolStore: desktopStore,
        discoverService: desktopDiscoverService,
        globalHelpers: desktopGlobalHelpers,
        cleanup,
      } = await bootstrapToolStoreWithDesktop(true);

      const mockData = {
        items: [{ identifier: 'desktop-plugin', name: 'Desktop Plugin' }] as PluginItem[],
        categories: [],
        totalCount: 1,
        totalPages: 1,
        currentPage: 1,
        pageSize: 20,
      };

      try {
        vi.spyOn(desktopGlobalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
        const fetchSpy = vi
          .spyOn(desktopDiscoverService, 'getMCPPluginList')
          .mockResolvedValue(mockData);

        const { result } = renderHook(() =>
          desktopStore.getState().useFetchMCPPluginList({ page: 1, pageSize: 20 }),
        );

        await waitFor(() => {
          expect(result.current.data).toEqual(mockData);
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [firstCallArgs] = fetchSpy.mock.calls[0];
        expect(firstCallArgs).toMatchObject({ page: 1, pageSize: 20 });
        expect(firstCallArgs.connectionType).toBeUndefined();
      } finally {
        cleanup();
      }
    });
  });

  describe('installMCPPlugin', () => {
    const mockPlugin: PluginItem = {
      identifier: 'test-plugin',
      name: 'Test Plugin',
      manifestUrl: 'https://example.com/manifest.json',
      icon: 'https://example.com/icon.png',
      description: 'Test description',
    } as PluginItem;

    const mockManifest = {
      name: 'Test Plugin',
      version: '1.0.0',
      deploymentOptions: [
        {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      ],
    };

    const mockCheckResult: CheckMcpInstallResult = {
      success: true,
      platform: 'darwin',
      allDependenciesMet: true,
      connection: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    };

    const mockServerManifest: LobeChatPluginManifest = {
      api: [],
      gateway: '',
      identifier: 'test-plugin',
      meta: {
        avatar: 'https://example.com/icon.png',
        description: 'Test description',
        title: 'Test Plugin',
      },
      type: 'standalone',
      version: '1',
    };

    beforeEach(() => {
      vi.spyOn(discoverService, 'getMCPPluginManifest').mockResolvedValue(mockManifest as any);
      vi.spyOn(mcpService, 'checkInstallation').mockResolvedValue(mockCheckResult);
      vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockResolvedValue(mockServerManifest);
      vi.spyOn(pluginService, 'installPlugin').mockResolvedValue(undefined);
      vi.spyOn(discoverService, 'reportMcpInstallResult').mockResolvedValue(undefined as any);
      vi.spyOn(discoverService, 'getMcpDetail').mockResolvedValue(mockPlugin as any);
    });

    describe('normal installation flow', () => {
      it('should successfully install MCP plugin', async () => {
        const { result } = renderHook(() => useToolStore());

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBe(true);
        expect(discoverService.getMCPPluginManifest).toHaveBeenCalledWith('test-plugin', {
          install: true,
        });
        expect(mcpService.checkInstallation).toHaveBeenCalled();
        expect(mcpService.getStdioMcpServerManifest).toHaveBeenCalled();
        expect(pluginService.installPlugin).toHaveBeenCalled();
        expect(result.current.refreshPlugins).toHaveBeenCalled();
      });

      it('should update progress through installation steps', async () => {
        const { result } = renderHook(() => useToolStore());

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        const progressUpdates: any[] = [];
        const updateProgressSpy = vi
          .spyOn(result.current, 'updateMCPInstallProgress')
          .mockImplementation((identifier, progress) => {
            progressUpdates.push({ identifier, progress });
          });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(progressUpdates.length).toBeGreaterThan(0);
        expect(
          progressUpdates.some((p) => p.progress?.step === MCPInstallStep.FETCHING_MANIFEST),
        ).toBe(true);
        expect(
          progressUpdates.some((p) => p.progress?.step === MCPInstallStep.CHECKING_INSTALLATION),
        ).toBe(true);
        expect(
          progressUpdates.some((p) => p.progress?.step === MCPInstallStep.GETTING_SERVER_MANIFEST),
        ).toBe(true);
        expect(
          progressUpdates.some((p) => p.progress?.step === MCPInstallStep.INSTALLING_PLUGIN),
        ).toBe(true);
        expect(progressUpdates.some((p) => p.progress?.step === MCPInstallStep.COMPLETED)).toBe(
          true,
        );

        updateProgressSpy.mockRestore();
      });

      it('should fetch plugin detail if not in store', async () => {
        const { result } = renderHook(() => useToolStore());

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(discoverService.getMcpDetail).toHaveBeenCalledWith({ identifier: 'test-plugin' });
      });

      it('should return early if plugin not found', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(discoverService, 'getMcpDetail').mockResolvedValue(null as any);

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('non-existent-plugin');
        });

        expect(installResult).toBeUndefined();
        expect(mcpService.checkInstallation).not.toHaveBeenCalled();
      });
    });

    describe('dependencies check', () => {
      it('should pause installation when dependencies not met', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'checkInstallation').mockResolvedValue({
          ...mockCheckResult,
          allDependenciesMet: false,
          systemDependencies: [
            {
              name: 'node',
              installed: false,
              meetRequirement: false,
            },
          ],
        });

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBe(false);
        expect(pluginService.installPlugin).not.toHaveBeenCalled();
      });

      it('should skip dependencies check when skipDepsCheck is true', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'checkInstallation').mockResolvedValue({
          ...mockCheckResult,
          allDependenciesMet: false,
        });

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin', {
            skipDepsCheck: true,
          });
        });

        expect(installResult).toBe(true);
        expect(pluginService.installPlugin).toHaveBeenCalled();
      });
    });

    describe('configuration requirement', () => {
      it('should pause installation when configuration is needed', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'checkInstallation').mockResolvedValue({
          ...mockCheckResult,
          needsConfig: true,
          configSchema: {
            type: 'object',
            properties: {
              apiKey: { type: 'string' },
            },
          },
        });

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBe(false);
        expect(pluginService.installPlugin).not.toHaveBeenCalled();
      });
    });

    describe('cloudEndPoint support', () => {
      it('should create cloud type connection when cloudEndPoint is available on web', async () => {
        const { result } = renderHook(() => useToolStore());

        const mockManifestWithCloudEndpoint = {
          ...mockManifest,
          cloudEndPoint: true,
          tools: [
            {
              name: 'testTool',
              description: 'Test tool description',
              inputSchema: {
                type: 'object',
                properties: {
                  param: { type: 'string' },
                },
              },
            },
          ],
          author: 'Test Author',
          createdAt: '2024-01-01T00:00:00Z',
          homepage: 'https://example.com',
          manifestUrl: 'https://example.com/manifest.json',
          icon: 'https://example.com/icon.png',
          description: 'Test description',
          tags: ['test'],
          deploymentOptions: [
            {
              connection: {
                type: 'stdio',
                configSchema: {
                  type: 'object',
                  properties: {
                    API_KEY: { type: 'string' },
                  },
                },
              },
              installationMethod: 'uv',
            },
          ],
        };

        vi.spyOn(discoverService, 'getMCPPluginManifest').mockResolvedValue(
          mockManifestWithCloudEndpoint as any,
        );

        // Mock isDesktop to false (web environment)
        const originalIsDesktop = (await import('@lobechat/const')).isDesktop;
        vi.spyOn(await import('@lobechat/const'), 'isDesktop', 'get').mockReturnValue(false);

        // Create plugin with haveCloudEndpoint field
        const mockPluginWithCloudEndpoint = {
          ...mockPlugin,
          haveCloudEndpoint: true,
        } as any;

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPluginWithCloudEndpoint],
          });
        });

        const installPluginSpy = vi.spyOn(pluginService, 'installPlugin');

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBe(true);

        // Should create cloud type connection
        expect(installPluginSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            customParams: expect.objectContaining({
              mcp: expect.objectContaining({
                type: 'cloud',
                cloudEndPoint: true,
              }),
            }),
          }),
        );

        // Should NOT call stdio connection
        expect(mcpService.getStdioMcpServerManifest).not.toHaveBeenCalled();
        // Should NOT call checkInstallation (skipped for cloud)
        expect(mcpService.checkInstallation).not.toHaveBeenCalled();

        // Restore original isDesktop
        vi.spyOn(await import('@lobechat/const'), 'isDesktop', 'get').mockReturnValue(
          originalIsDesktop,
        );
      });

      it('should use stdio deployment when cloudEndPoint is not available', async () => {
        const { result } = renderHook(() => useToolStore());

        // No cloudEndPoint in manifest
        const mockManifestWithoutCloudEndpoint = {
          ...mockManifest,
          deploymentOptions: [
            {
              connection: {
                type: 'stdio',
              },
              installationMethod: 'uv',
            },
          ],
        };

        vi.spyOn(discoverService, 'getMCPPluginManifest').mockResolvedValue(
          mockManifestWithoutCloudEndpoint as any,
        );

        // Mock isDesktop to false (web environment)
        const originalIsDesktop = (await import('@lobechat/const')).isDesktop;
        vi.spyOn(await import('@lobechat/const'), 'isDesktop', 'get').mockReturnValue(false);

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBe(true);
        // Should fall back to stdio
        expect(mcpService.checkInstallation).toHaveBeenCalled();
        expect(mcpService.getStdioMcpServerManifest).toHaveBeenCalled();

        // Restore original isDesktop
        vi.spyOn(await import('@lobechat/const'), 'isDesktop', 'get').mockReturnValue(
          originalIsDesktop,
        );
      });
    });

    describe('resume mode', () => {
      it('should resume installation with previous config info', async () => {
        const { result } = renderHook(() => useToolStore());

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
            mcpInstallProgress: {
              'test-plugin': {
                progress: 50,
                step: MCPInstallStep.CONFIGURATION_REQUIRED,
                manifest: mockManifest,
                connection: mockCheckResult.connection,
                checkResult: mockCheckResult,
              },
            },
          });
        });

        const config = { apiKey: 'test-key' };

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin', { resume: true, config });
        });

        expect(discoverService.getMCPPluginManifest).not.toHaveBeenCalled();
        expect(mcpService.checkInstallation).not.toHaveBeenCalled();
        expect(mcpService.getStdioMcpServerManifest).toHaveBeenCalledWith(
          expect.objectContaining({
            env: config,
          }),
          expect.any(Object),
          expect.any(AbortSignal),
        );
      });

      it('should return early if config info not found in resume mode', async () => {
        const { result } = renderHook(() => useToolStore());

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
            mcpInstallProgress: {},
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin', { resume: true });
        });

        expect(installResult).toBeUndefined();
      });
    });

    describe('HTTP connection', () => {
      it('should install HTTP MCP plugin', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'checkInstallation').mockResolvedValue({
          ...mockCheckResult,
          connection: {
            type: 'http',
            url: 'https://example.com/mcp',
          },
        });

        vi.spyOn(mcpService, 'getStreamableMcpServerManifest').mockResolvedValue(
          mockServerManifest,
        );

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(mcpService.getStreamableMcpServerManifest).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://example.com/mcp',
            identifier: 'test-plugin',
          }),
          expect.any(AbortSignal),
        );
      });
    });

    describe('version handling', () => {
      it('should use larger version from manifest and data', async () => {
        const { result } = renderHook(() => useToolStore());

        const manifestWithVersion = {
          ...mockManifest,
          version: '1.5.0',
        };

        const serverManifestWithVersion: LobeChatPluginManifest = {
          api: [],
          gateway: '',
          identifier: 'test-plugin',
          meta: {
            avatar: 'https://example.com/icon.png',
            description: 'Test description',
            title: 'Test Plugin',
          },
          type: 'standalone',
          version: '1',
        };

        vi.spyOn(discoverService, 'getMCPPluginManifest').mockResolvedValue(
          manifestWithVersion as any,
        );
        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockResolvedValue(
          serverManifestWithVersion,
        );

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        const installPluginSpy = vi.spyOn(pluginService, 'installPlugin');

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(installPluginSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            manifest: expect.objectContaining({
              version: '1.5.0',
            }),
          }),
        );
      });
    });

    describe('cancellation', () => {
      it('should handle cancellation during installation', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'checkInstallation').mockImplementation(async (manifest, signal) => {
          // Cancel after check
          setTimeout(() => {
            result.current.cancelInstallMCPPlugin('test-plugin');
          }, 10);

          await new Promise((resolve) => setTimeout(resolve, 20));

          return mockCheckResult;
        });

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        // Should not install if cancelled
        expect(pluginService.installPlugin).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle structured MCP error', async () => {
        const { result } = renderHook(() => useToolStore());

        // Create proper TRPC error with data property
        const mcpError: any = new Error('MCP Error');
        mcpError.data = {
          errorData: {
            type: 'CONNECTION_ERROR',
            message: 'Failed to connect to MCP server',
            metadata: {
              step: 'connection',
              timestamp: Date.now(),
            },
          },
        };

        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockRejectedValue(mcpError);

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        const progress = result.current.mcpInstallProgress['test-plugin'];
        expect(progress?.step).toBe(MCPInstallStep.ERROR);
        expect(progress?.errorInfo).toMatchObject({
          type: 'CONNECTION_ERROR',
          message: 'Failed to connect to MCP server',
          metadata: expect.objectContaining({
            step: 'connection',
          }),
        });
      });

      it('should handle generic error', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockRejectedValue(
          new Error('Generic error'),
        );

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(result.current.mcpInstallProgress['test-plugin']).toMatchObject({
          step: MCPInstallStep.ERROR,
          errorInfo: {
            type: 'UNKNOWN_ERROR',
            message: 'Generic error',
          },
        });
      });

      it('should return undefined if manifest not retrieved', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockResolvedValue(undefined as any);

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBeUndefined();
        expect(pluginService.installPlugin).not.toHaveBeenCalled();
      });

      it('should return undefined if installation check fails', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'checkInstallation').mockResolvedValue({
          ...mockCheckResult,
          success: false,
        });

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        let installResult;
        await act(async () => {
          installResult = await result.current.installMCPPlugin('test-plugin');
        });

        expect(installResult).toBeUndefined();
        expect(mcpService.getStdioMcpServerManifest).not.toHaveBeenCalled();
      });

      it('should report installation failure', async () => {
        const { result } = renderHook(() => useToolStore());

        vi.spyOn(mcpService, 'getStdioMcpServerManifest').mockRejectedValue(
          new Error('Installation failed'),
        );

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(discoverService.reportMcpInstallResult).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            errorMessage: 'Installation failed',
            identifier: 'test-plugin',
          }),
        );
      });
    });

    describe('installation reporting', () => {
      it('should report successful installation', async () => {
        const { result } = renderHook(() => useToolStore());

        act(() => {
          useToolStore.setState({
            mcpPluginItems: [mockPlugin],
          });
        });

        await act(async () => {
          await result.current.installMCPPlugin('test-plugin');
        });

        expect(discoverService.reportMcpInstallResult).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            identifier: 'test-plugin',
            platform: 'darwin',
            version: '1.0.0',
          }),
        );
      });
    });
  });
});
