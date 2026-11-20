import type * as LobeConst from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { mcpService } from '@/services/mcp';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeConst>()),
  isDesktop: true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      getForEdit: { query: vi.fn() },
      getLocalCallToken: { mutate: vi.fn() },
      list: { query: vi.fn().mockResolvedValue([]) },
      syncTools: { mutate: vi.fn() },
      syncToolsFromClientById: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@/services/mcp', () => ({ mcpService: { listLocalMcpTools: vi.fn() } }));

const listedTools = [
  { description: 'Show it', inputSchema: { type: 'object' }, name: 'show_dashboard' },
  { inputSchema: { type: 'object' }, name: 'load_page', visibility: ['app'] },
];

describe('syncConnectorTools on desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStore.setState({ ...initialConnectorState });
    vi.mocked(mcpService.listLocalMcpTools).mockResolvedValue(listedTools);
  });

  it.each([
    [
      'stdio',
      { mcpConnectionType: 'stdio', mcpStdioConfig: { args: [], command: 'dash-mcp' } },
      { stdio: { args: [], command: 'dash-mcp', env: undefined, name: 'dash' } },
    ],
    [
      'local HTTP',
      { mcpConnectionType: 'http', mcpServerUrl: 'http://localhost:4000/mcp' },
      { http: { name: 'dash', url: 'http://localhost:4000/mcp' } },
    ],
  ])(
    'syncs every %s tool, view-only ones included, with its visibility',
    async (_, detail, listInput) => {
      vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValue({
        credentials: null,
        identifier: 'dash',
        metadata: null,
        ...detail,
      } as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.syncConnectorTools('c1');
      });

      expect(mcpService.listLocalMcpTools).toHaveBeenCalledWith(expect.objectContaining(listInput));
      expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
        id: 'c1',
        tools: [
          {
            description: 'Show it',
            inputSchema: { type: 'object' },
            toolName: 'show_dashboard',
            visibility: undefined,
          },
          {
            description: undefined,
            inputSchema: { type: 'object' },
            toolName: 'load_page',
            visibility: ['app'],
          },
        ],
      });
      expect(lambdaClient.connector.syncTools.mutate).not.toHaveBeenCalled();
    },
  );

  // `getForEdit` leaves OAuth tokens out: listing without one would fail
  it('lists an OAuth connector set to connect through the device with its access token', async () => {
    vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValue({
      credentials: null,
      id: 'c1',
      identifier: 'dash',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
      metadata: { connectVia: 'device' },
      oidcConfig: { clientId: 'cid', issuer: 'https://auth.example.com' },
    } as any);
    vi.mocked(lambdaClient.connector.getLocalCallToken.mutate).mockResolvedValue({
      accessToken: 'fresh-access',
      type: 'oauth2',
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.syncConnectorTools('c1');
    });

    expect(lambdaClient.connector.getLocalCallToken.mutate).toHaveBeenCalledWith({ id: 'c1' });
    expect(mcpService.listLocalMcpTools).toHaveBeenCalledWith({
      http: expect.objectContaining({
        auth: { accessToken: 'fresh-access', type: 'oauth2' },
        url: 'https://nas.tail1234.ts.net/mcp',
      }),
    });
  });
});
