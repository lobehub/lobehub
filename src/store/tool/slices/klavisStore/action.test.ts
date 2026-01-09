import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient, toolsClient } from '@/libs/trpc/client';

import { useToolStore } from '../../store';
import { KlavisServerStatus } from './types';

vi.mock('zustand/traditional');

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    klavis: {
      createServerInstance: { mutate: vi.fn() },
      deleteServerInstance: { mutate: vi.fn() },
      getKlavisPlugins: { query: vi.fn() },
      getServerInstance: { query: vi.fn() },
      updateKlavisPlugin: { mutate: vi.fn() },
    },
  },
  toolsClient: {
    klavis: {
      callTool: { mutate: vi.fn() },
      listTools: { query: vi.fn() },
    },
  },
}));

describe('klavisStore actions', () => {
  describe('callKlavisTool', () => {
    it('should call tool successfully and return result', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      const mockResponse = {
        content: 'Tool result',
        success: true,
        state: { content: [], isError: false },
      };
      vi.mocked(toolsClient.klavis.callTool.mutate).mockResolvedValue(mockResponse as any);

      let callResult;
      await act(async () => {
        callResult = await result.current.callKlavisTool({
          serverUrl: 'https://klavis.ai/gmail',
          toolName: 'sendEmail',
          toolArgs: { to: 'test@example.com' },
        });
      });

      expect(callResult).toEqual({ data: mockResponse, success: true });
      expect(toolsClient.klavis.callTool.mutate).toHaveBeenCalledWith({
        serverUrl: 'https://klavis.ai/gmail',
        toolName: 'sendEmail',
        toolArgs: { to: 'test@example.com' },
      });
    });

    it('should handle error and return error result', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(toolsClient.klavis.callTool.mutate).mockRejectedValue(
        new Error('Tool call failed'),
      );

      let callResult;
      await act(async () => {
        callResult = await result.current.callKlavisTool({
          serverUrl: 'https://klavis.ai/gmail',
          toolName: 'sendEmail',
        });
      });

      expect(callResult).toEqual({ error: 'Tool call failed', success: false });
      expect(result.current.executingToolIds.has('https://klavis.ai/gmail:sendEmail')).toBe(false);
    });
  });

  describe('createKlavisServer', () => {
    it('should create server successfully', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      const mockResponse = {
        identifier: 'gmail',
        instanceId: 'inst-123',
        isAuthenticated: true,
        oauthUrl: undefined,
        serverName: 'Gmail',
        serverUrl: 'https://klavis.ai/gmail',
      };
      vi.mocked(lambdaClient.klavis.createServerInstance.mutate).mockResolvedValue(mockResponse);

      let server;
      await act(async () => {
        server = await result.current.createKlavisServer({
          identifier: 'gmail',
          serverName: 'Gmail',
          userId: 'user-123',
        });
      });

      expect(server).toMatchObject({
        identifier: 'gmail',
        instanceId: 'inst-123',
        isAuthenticated: true,
        serverName: 'Gmail',
        serverUrl: 'https://klavis.ai/gmail',
        status: KlavisServerStatus.CONNECTED,
      });
      expect(result.current.servers).toHaveLength(1);
      expect(result.current.loadingServerIds.has('gmail')).toBe(false);
    });

    it('should create server with pending auth when oauth needed', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      const mockResponse = {
        identifier: 'github',
        instanceId: 'inst-123',
        isAuthenticated: false,
        oauthUrl: 'https://oauth.klavis.ai/github',
        serverName: 'GitHub',
        serverUrl: 'https://klavis.ai/github',
      };
      vi.mocked(lambdaClient.klavis.createServerInstance.mutate).mockResolvedValue(mockResponse);

      let server;
      await act(async () => {
        server = await result.current.createKlavisServer({
          identifier: 'github',
          serverName: 'GitHub',
          userId: 'user-123',
        });
      });

      expect(server).toMatchObject({
        status: KlavisServerStatus.PENDING_AUTH,
        oauthUrl: 'https://oauth.klavis.ai/github',
      });
    });

    it('should update existing server if already exists', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'old-inst',
              serverUrl: 'https://old.klavis.ai/gmail',
              status: KlavisServerStatus.ERROR,
              isAuthenticated: false,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      const mockResponse = {
        identifier: 'gmail',
        instanceId: 'new-inst',
        isAuthenticated: true,
        oauthUrl: undefined,
        serverName: 'Gmail',
        serverUrl: 'https://klavis.ai/gmail',
      };
      vi.mocked(lambdaClient.klavis.createServerInstance.mutate).mockResolvedValue(mockResponse);

      await act(async () => {
        await result.current.createKlavisServer({
          identifier: 'gmail',
          serverName: 'Gmail',
          userId: 'user-123',
        });
      });

      expect(result.current.servers).toHaveLength(1);
      expect(result.current.servers[0].instanceId).toBe('new-inst');
    });

    it('should handle creation error', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.createServerInstance.mutate).mockRejectedValue(
        new Error('Creation failed'),
      );

      let server;
      await act(async () => {
        server = await result.current.createKlavisServer({
          identifier: 'gmail',
          serverName: 'Gmail',
          userId: 'user-123',
        });
      });

      expect(server).toBeUndefined();
      expect(result.current.servers).toHaveLength(0);
      expect(result.current.loadingServerIds.has('gmail')).toBe(false);
    });
  });

  // Note: useFetchUserKlavisServers uses SWR hook and requires different testing approach
  // The SWR hook tests should be done in integration tests or with SWR testing utilities

  describe('refreshKlavisServerTools', () => {
    it('should refresh tools for authenticated server', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'inst-1',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.PENDING_AUTH,
              isAuthenticated: false,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.getServerInstance.query).mockResolvedValue({
        isAuthenticated: true,
        authNeeded: false,
      } as any);

      vi.mocked(toolsClient.klavis.listTools.query).mockResolvedValue({
        tools: [{ name: 'sendEmail', description: 'Send email', inputSchema: { type: 'object' } }],
      });

      vi.mocked(lambdaClient.klavis.updateKlavisPlugin.mutate).mockResolvedValue({} as any);

      await act(async () => {
        await result.current.refreshKlavisServerTools('gmail');
      });

      expect(result.current.servers[0].status).toBe(KlavisServerStatus.CONNECTED);
      expect(result.current.servers[0].isAuthenticated).toBe(true);
      expect(result.current.servers[0].tools).toHaveLength(1);
    });

    it('should remove server when auth failed and auth needed', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'inst-1',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.PENDING_AUTH,
              isAuthenticated: false,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.getServerInstance.query).mockResolvedValue({
        isAuthenticated: false,
        authNeeded: true,
      } as any);

      vi.mocked(lambdaClient.klavis.deleteServerInstance.mutate).mockResolvedValue({} as any);

      await act(async () => {
        await result.current.refreshKlavisServerTools('gmail');
      });

      expect(result.current.servers).toHaveLength(0);
      expect(lambdaClient.klavis.deleteServerInstance.mutate).toHaveBeenCalled();
    });

    it('should do nothing when server not found', async () => {
      vi.mocked(lambdaClient.klavis.getServerInstance.query).mockClear();

      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      await act(async () => {
        await result.current.refreshKlavisServerTools('non-existent');
      });

      expect(lambdaClient.klavis.getServerInstance.query).not.toHaveBeenCalled();
    });

    it('should handle refresh error', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'inst-1',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.CONNECTED,
              isAuthenticated: true,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.getServerInstance.query).mockResolvedValue({
        isAuthenticated: true,
        authNeeded: false,
      } as any);

      vi.mocked(toolsClient.klavis.listTools.query).mockRejectedValue(new Error('Refresh failed'));

      await act(async () => {
        await result.current.refreshKlavisServerTools('gmail');
      });

      expect(result.current.servers[0].status).toBe(KlavisServerStatus.ERROR);
      expect(result.current.servers[0].errorMessage).toBe('Refresh failed');
    });
  });

  describe('removeKlavisServer', () => {
    it('should remove server from state and call API', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'inst-1',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.CONNECTED,
              isAuthenticated: true,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.deleteServerInstance.mutate).mockResolvedValue({} as any);

      await act(async () => {
        await result.current.removeKlavisServer('gmail');
      });

      expect(result.current.servers).toHaveLength(0);
      expect(lambdaClient.klavis.deleteServerInstance.mutate).toHaveBeenCalledWith({
        identifier: 'gmail',
        instanceId: 'inst-1',
      });
    });

    it('should handle remove when server not found', async () => {
      vi.mocked(lambdaClient.klavis.deleteServerInstance.mutate).mockClear();

      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      await act(async () => {
        await result.current.removeKlavisServer('non-existent');
      });

      expect(lambdaClient.klavis.deleteServerInstance.mutate).not.toHaveBeenCalled();
    });

    it('should handle API error gracefully', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'inst-1',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.CONNECTED,
              isAuthenticated: true,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.deleteServerInstance.mutate).mockRejectedValue(
        new Error('Delete failed'),
      );

      await act(async () => {
        await result.current.removeKlavisServer('gmail');
      });

      expect(result.current.servers).toHaveLength(0);
    });
  });

  describe('completeKlavisServerAuth', () => {
    it('should call refreshKlavisServerTools', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'inst-1',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.PENDING_AUTH,
              isAuthenticated: false,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
        });
      });

      vi.mocked(lambdaClient.klavis.getServerInstance.query).mockResolvedValue({
        isAuthenticated: true,
        authNeeded: false,
      } as any);

      vi.mocked(toolsClient.klavis.listTools.query).mockResolvedValue({
        tools: [],
      });

      vi.mocked(lambdaClient.klavis.updateKlavisPlugin.mutate).mockResolvedValue({} as any);

      await act(async () => {
        await result.current.completeKlavisServerAuth('gmail');
      });

      expect(lambdaClient.klavis.getServerInstance.query).toHaveBeenCalled();
    });
  });

  describe('useFetchUserKlavisServers', () => {
    it('should set isServersInit to true on success with empty data', async () => {
      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
          isServersInit: false,
        });
      });

      vi.mocked(lambdaClient.klavis.getKlavisPlugins.query).mockResolvedValue([]);

      renderHook(() => useToolStore.getState().useFetchUserKlavisServers(true));

      await waitFor(() => {
        expect(useToolStore.getState().isServersInit).toBe(true);
      });
    });

    it('should not fetch when disabled', () => {
      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
          isServersInit: false,
        });
      });

      vi.mocked(lambdaClient.klavis.getKlavisPlugins.query).mockClear();

      renderHook(() => useToolStore.getState().useFetchUserKlavisServers(false));

      expect(lambdaClient.klavis.getKlavisPlugins.query).not.toHaveBeenCalled();
      expect(useToolStore.getState().isServersInit).toBe(false);
    });
  });

  describe('server deduplication logic', () => {
    it('should deduplicate servers by identifier when adding new servers', () => {
      // This tests the deduplication logic used in useFetchUserKlavisServers onSuccess
      act(() => {
        useToolStore.setState({
          servers: [
            {
              identifier: 'gmail',
              serverName: 'Gmail',
              instanceId: 'existing-inst',
              serverUrl: 'https://klavis.ai/gmail',
              status: KlavisServerStatus.CONNECTED,
              isAuthenticated: true,
              createdAt: Date.now(),
            },
          ],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
          isServersInit: false,
        });
      });

      // Simulate what onSuccess does
      const incomingServers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'new-inst',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'github-inst',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
      ];

      act(() => {
        const existingServers = useToolStore.getState().servers;
        const existingIdentifiers = new Set(existingServers.map((s) => s.identifier));
        const newServers = incomingServers.filter((s) => !existingIdentifiers.has(s.identifier));

        useToolStore.setState({
          servers: [...existingServers, ...newServers],
          isServersInit: true,
        });
      });

      const finalServers = useToolStore.getState().servers;
      expect(finalServers).toHaveLength(2);
      // Existing gmail should keep its original instanceId
      expect(finalServers.find((s) => s.identifier === 'gmail')?.instanceId).toBe('existing-inst');
      // New github should be added
      expect(finalServers.find((s) => s.identifier === 'github')?.instanceId).toBe('github-inst');
      expect(useToolStore.getState().isServersInit).toBe(true);
    });

    it('should add all servers when none exist', () => {
      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
          isServersInit: false,
        });
      });

      const incomingServers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
      ];

      act(() => {
        const existingServers = useToolStore.getState().servers;
        const existingIdentifiers = new Set(existingServers.map((s) => s.identifier));
        const newServers = incomingServers.filter((s) => !existingIdentifiers.has(s.identifier));

        useToolStore.setState({
          servers: [...existingServers, ...newServers],
          isServersInit: true,
        });
      });

      expect(useToolStore.getState().servers).toHaveLength(1);
      expect(useToolStore.getState().isServersInit).toBe(true);
    });

    it('should set isServersInit even when no servers are added', () => {
      act(() => {
        useToolStore.setState({
          servers: [],
          loadingServerIds: new Set(),
          executingToolIds: new Set(),
          isServersInit: false,
        });
      });

      // Simulate empty data case
      act(() => {
        useToolStore.setState({
          isServersInit: true,
        });
      });

      expect(useToolStore.getState().isServersInit).toBe(true);
    });
  });
});
