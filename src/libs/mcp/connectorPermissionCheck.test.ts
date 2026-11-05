import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBlockedToolResponse, getConnectorToolPermission } from './connectorPermissionCheck';

const storage = vi.hoisted(() => ({ resolve: vi.fn(), tools: vi.fn() }));
vi.mock('./agentPluginAccess', () => ({ isAgentPluginDisabled: async () => false }));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: class {
    resolveByIdentifiers = storage.resolve;
  },
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: class {
    queryByConnector = storage.tools;
  },
}));

const connection = () => ({
  id: 'gmail-connection',
  agentId: null,
  identifier: 'gmail',
  isEnabled: true,
  status: 'connected',
  metadata: {
    nativeAccess: {
      agentIds: ['toby'],
      readToolNames: ['GMAIL_FETCH_EMAILS'],
    },
  },
});
const permission = (toolName = 'GMAIL_FETCH_EMAILS', agentId: string | undefined = 'toby') =>
  getConnectorToolPermission({} as any, 'user', 'gmail', toolName, undefined, agentId);

beforeEach(() => {
  storage.resolve.mockReset().mockResolvedValue([connection()]);
  storage.tools.mockReset().mockResolvedValue([
    { toolName: 'GMAIL_FETCH_EMAILS', permission: 'auto' },
    { toolName: 'GMAIL_SEND_EMAIL', permission: 'auto' },
  ]);
});

describe('managed connection execution boundary', () => {
  it('fails closed for managed Notion until Market can atomically bind the approved account', async () => {
    const row = {
      ...connection(),
      identifier: 'notion',
      metadata: { nativeAccess: { agentIds: ['toby'], readToolNames: ['notion-search'] } },
    };
    storage.resolve.mockResolvedValue([row]);
    storage.tools.mockResolvedValue([{ toolName: 'notion-search', permission: 'auto' }]);
    expect(
      await getConnectorToolPermission(
        {} as any,
        'user',
        'notion',
        'notion-search',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
  });

  it('reports a blocked invocation as a failed tool result, not a successful read', () => {
    expect(buildBlockedToolResponse('GMAIL_FETCH_EMAILS')).toMatchObject({
      success: false,
      state: { isError: true },
    });
  });

  it('rejects a new connection before any agent has confirmed access', async () => {
    const row = connection();
    row.metadata.nativeAccess.agentIds = [];
    storage.resolve.mockResolvedValue([row]);
    expect(await permission()).toBe('disabled');
  });

  it('allows a confirmed agent to execute an explicitly approved read tool', async () => {
    expect(await permission()).toBe('auto');
  });

  it('rejects another agent even if it discovers the same service', async () => {
    expect(await permission('GMAIL_FETCH_EMAILS', 'work-agent')).toBe('disabled');
  });

  it('rejects a direct call without an agent identity', async () => {
    expect(await getConnectorToolPermission({} as any, 'user', 'gmail', 'GMAIL_FETCH_EMAILS')).toBe(
      'disabled',
    );
  });

  it('rejects a write tool even when its ordinary tool permission is auto', async () => {
    expect(await permission('GMAIL_SEND_EMAIL')).toBe('disabled');
  });

  it('rejects an unknown tool instead of treating missing permission as unrestricted', async () => {
    expect(await permission('NEW_TOOL')).toBe('disabled');
  });

  it.each(['disabled', 'disconnected'])(
    'rejects new calls after connection becomes %s',
    async (state) => {
      storage.resolve.mockResolvedValue([
        {
          ...connection(),
          isEnabled: state !== 'disabled',
          status: state === 'disconnected' ? state : 'connected',
        },
      ]);
      expect(await permission()).toBe('disabled');
    },
  );

  it('fails closed when the connection lookup cannot establish current access', async () => {
    storage.resolve.mockRejectedValue(new Error('database unavailable'));
    expect(await permission()).toBe('disabled');
  });

  it('does not bypass a disabled tool permission within the read policy', async () => {
    storage.tools.mockResolvedValue([{ toolName: 'GMAIL_FETCH_EMAILS', permission: 'disabled' }]);
    expect(await permission()).toBe('disabled');
  });

  it('keeps ordinary permissions for a connection without the native management policy', async () => {
    storage.resolve.mockResolvedValue([{ ...connection(), metadata: {} }]);
    expect(await permission('GMAIL_SEND_EMAIL')).toBe('auto');
  });

  it('does not treat a malformed managed policy as an unmanaged connection', async () => {
    storage.resolve.mockResolvedValue([{ ...connection(), metadata: { nativeAccess: null } }]);
    expect(await permission()).toBe('disabled');
  });
});
