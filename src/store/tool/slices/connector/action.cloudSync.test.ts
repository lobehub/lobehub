import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { discoverService } from '@/services/discover';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';
import type { ConnectorWithTools } from './types';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      getForEdit: { query: vi.fn() },
      list: { query: vi.fn().mockResolvedValue([]) },
      syncTools: { mutate: vi.fn() },
      syncToolsFromClientById: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@/services/discover', () => ({
  discoverService: { getMCPPluginManifest: vi.fn() },
}));

const cloudConnector = {
  id: 'c1',
  identifier: 'market-mcp',
  isEnabled: true,
  mcpConnectionType: 'cloud',
  mcpServerUrl: null,
  metadata: { marketplaceInstalled: true },
  sourceType: 'marketplace',
  status: 'connected',
  tools: [],
} as unknown as ConnectorWithTools;

// A market-hosted server has no endpoint of its own: Refresh re-reads its tools
// from the market manifest, the way the install did.
describe('syncConnectorTools for a cloud connector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStore.setState({ ...initialConnectorState, connectors: [cloudConnector] });
  });

  it('syncs the tools of the market manifest, approval requirements included', async () => {
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue({
      tools: [{ description: 'Search', inputSchema: { type: 'object' }, name: 'search' }],
    } as any);

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.syncConnectorTools('c1');
    });

    expect(discoverService.getMCPPluginManifest).toHaveBeenCalledWith('market-mcp');
    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'c1',
      tools: [
        {
          description: 'Search',
          humanIntervention: undefined,
          inputSchema: { type: 'object' },
          toolName: 'search',
        },
      ],
    });
    // Never asks the server to connect to an endpoint the row does not have
    expect(lambdaClient.connector.syncTools.mutate).not.toHaveBeenCalled();
    expect(lambdaClient.connector.getForEdit.query).not.toHaveBeenCalled();
  });

  it('keeps a manifest api entry and its intervention policy', async () => {
    vi.mocked(discoverService.getMCPPluginManifest).mockResolvedValue({
      api: [{ description: 'Send', humanIntervention: 'required', name: 'send', parameters: {} }],
    } as any);

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.syncConnectorTools('c1');
    });

    expect(lambdaClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'c1',
      tools: [
        { description: 'Send', humanIntervention: 'required', inputSchema: {}, toolName: 'send' },
      ],
    });
  });

  it('syncs any other connector on the server', async () => {
    useToolStore.setState({
      connectors: [{ ...cloudConnector, mcpConnectionType: 'http', mcpServerUrl: 'https://x.dev' }],
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.syncConnectorTools('c1');
    });

    expect(discoverService.getMCPPluginManifest).not.toHaveBeenCalled();
    expect(lambdaClient.connector.syncTools.mutate).toHaveBeenCalledWith({ id: 'c1' });
  });
});
