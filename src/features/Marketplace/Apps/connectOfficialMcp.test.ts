import type { OfficialMcpServerType } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolStore } from '@/store/tool/store';

import { connectOfficialMcp } from './connectOfficialMcp';

const executeOAuthCreate = vi.hoisted(() => vi.fn());
vi.mock('@/utils/connectorOAuthCreate', () => ({ executeOAuthCreate }));
vi.mock('@/utils/connectorOAuth', () => ({ waitForConnectorOAuth: vi.fn() }));

const server: OfficialMcpServerType = {
  auth: 'oauth',
  author: 'Sentry',
  category: 'coding',
  description: 'Look up issues',
  icon: 'https://example.com/sentry.ico',
  identifier: 'sentry',
  label: 'Sentry',
  url: 'https://mcp.sentry.dev/mcp',
};

const createStore = () => {
  const store = {
    connectors: [],
    createConnector: vi.fn(async () => ({ id: 'c1', isNew: true })),
    deleteConnector: vi.fn(async () => {}),
    fetchConnectors: vi.fn(async () => {}),
    startConnectorOAuth: vi.fn(async () => 'https://auth'),
    syncConnectorTools: vi.fn(async () => {}),
  };
  return { get: () => store as unknown as ToolStore, store };
};

describe('connectOfficialMcp', () => {
  beforeEach(() => executeOAuthCreate.mockReset());

  it('creates an HTTP connector and lets the server resolve the OAuth client', async () => {
    const { get } = createStore();
    await connectOfficialMcp(server, null, get);
    expect(executeOAuthCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'sentry',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.sentry.dev/mcp',
        oidcConfig: { scheme: 'dcr' },
        sourceType: 'custom',
      }),
      null,
      expect.any(Object),
    );
  });

  it('lists a public server’s tools without OAuth', async () => {
    const { get, store } = createStore();
    await connectOfficialMcp({ ...server, auth: 'none' }, undefined, get);
    expect(executeOAuthCreate).not.toHaveBeenCalled();
    expect(store.syncConnectorTools).toHaveBeenCalledWith('c1');
  });

  it('rolls back a new public connector whose tools cannot be listed', async () => {
    const { get, store } = createStore();
    store.syncConnectorTools.mockRejectedValueOnce(new Error('unreachable'));
    await expect(connectOfficialMcp({ ...server, auth: 'none' }, undefined, get)).rejects.toThrow(
      'unreachable',
    );
    expect(store.deleteConnector).toHaveBeenCalledWith('c1');
  });
});
