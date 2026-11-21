import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: { list: { query: vi.fn() } },
  },
}));

const installed = {
  id: 'c1',
  identifier: 'market-mcp',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  metadata: { marketplaceInstalled: true },
  sourceType: 'marketplace',
  status: 'connected',
  tools: [],
};

describe('useFetchConnectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStore.setState({ ...initialConnectorState });
    vi.mocked(lambdaClient.connector.list.query).mockResolvedValue([installed] as never);
  });

  it('loads the connector list once for every view that mounts it', async () => {
    renderHook(() => {
      const useFetchConnectors = useToolStore((s) => s.useFetchConnectors);
      useFetchConnectors(true);
      useFetchConnectors(true);
    });

    await waitFor(() => expect(useToolStore.getState().isConnectorsInit).toBe(true));
    expect(useToolStore.getState().connectors.map((c) => c.identifier)).toEqual(['market-mcp']);
    expect(lambdaClient.connector.list.query).toHaveBeenCalledTimes(1);
  });

  it('loads nothing when disabled', async () => {
    renderHook(() => useToolStore((s) => s.useFetchConnectors)(false));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lambdaClient.connector.list.query).not.toHaveBeenCalled();
  });
});
