// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composioRouter } from './composio';

const mocks = vi.hoisted(() => ({
  // composio client
  authConfigsCreate: vi.fn(),
  authConfigsList: vi.fn(),
  connectedAccountsDelete: vi.fn(),
  connectedAccountsLink: vi.fn(),
  connectorCreate: vi.fn(),
  connectorDelete: vi.fn(),
  connectorFindScopedByIdentifier: vi.fn(),
  connectorToolDeleteToolsNotIn: vi.fn(),
  connectorToolUpsertMany: vi.fn(),
  connectorUpdate: vi.fn(),
  getRawComposioTools: vi.fn(),
  // config
  getServerComposioAuthConfigId: vi.fn(),
  // plugin model
  pluginCreate: vi.fn(),
  pluginDelete: vi.fn(),
  pluginFindById: vi.fn(),
  pluginUpdate: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/config/composio', () => ({
  getServerComposioAuthConfigId: mocks.getServerComposioAuthConfigId,
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    create: mocks.pluginCreate,
    delete: mocks.pluginDelete,
    findById: mocks.pluginFindById,
    update: mocks.pluginUpdate,
  })),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    create: mocks.connectorCreate,
    delete: mocks.connectorDelete,
    findScopedByIdentifier: mocks.connectorFindScopedByIdentifier,
    update: mocks.connectorUpdate,
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    deleteToolsNotIn: mocks.connectorToolDeleteToolsNotIn,
    upsertMany: mocks.connectorToolUpsertMany,
  })),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    authConfigs: { create: mocks.authConfigsCreate, list: mocks.authConfigsList },
    connectedAccounts: { delete: mocks.connectedAccountsDelete, link: mocks.connectedAccountsLink },
    tools: { getRawComposioTools: mocks.getRawComposioTools },
  }),
}));

const caller = () => composioRouter.createCaller({ userId: 'user-1' } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorFindScopedByIdentifier.mockResolvedValue(null);
  mocks.connectorCreate.mockResolvedValue({ id: 'conn-new' });
  mocks.pluginFindById.mockResolvedValue(undefined);
});

describe('composioRouter.createConnection dual-write', () => {
  it('mirrors a pending connection into user_connectors + tools', async () => {
    mocks.getServerComposioAuthConfigId.mockReturnValue('ac_env');
    mocks.connectedAccountsLink.mockResolvedValue({ id: 'ca-1', redirectUrl: 'https://auth' });
    mocks.getRawComposioTools.mockResolvedValue({
      items: [{ description: 'send', inputParameters: { type: 'object' }, slug: 'GMAIL_SEND' }],
    });

    await caller().createConnection({ appSlug: 'GMAIL', identifier: 'gmail', label: 'Gmail' });

    // plugin write kept (backward compat)
    expect(mocks.pluginCreate).toHaveBeenCalledTimes(1);
    // connector projection created with PENDING composio metadata
    expect(mocks.connectorCreate).toHaveBeenCalledTimes(1);
    expect(mocks.connectorCreate.mock.calls[0][0]).toMatchObject({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'ca-1', status: 'PENDING' } },
      status: 'disconnected',
    });
    // tools seeded
    expect(mocks.connectorToolUpsertMany).toHaveBeenCalledWith('conn-new', [
      expect.objectContaining({ toolName: 'GMAIL_SEND' }),
    ]);
    // pre-auth seed must NOT prune (tool list may be incomplete before auth)
    expect(mocks.connectorToolDeleteToolsNotIn).not.toHaveBeenCalled();
  });
});

describe('composioRouter.updateComposioPlugin dual-write', () => {
  const input = {
    appSlug: 'GMAIL',
    authConfigId: 'ac_env',
    connectedAccountId: 'ca-1',
    identifier: 'gmail',
    label: 'Gmail',
    status: 'ACTIVE',
    tools: [{ description: 'send', inputSchema: { type: 'object' }, name: 'GMAIL_SEND' }],
  };

  it('creates the connector projection (ACTIVE) + tools when none exists', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue(null);

    const res = await caller().updateComposioPlugin(input);

    expect(res).toEqual({ savedCount: 1 });
    expect(mocks.connectorCreate).toHaveBeenCalledTimes(1);
    expect(mocks.connectorCreate.mock.calls[0][0]).toMatchObject({
      metadata: { composio: { connectedAccountId: 'ca-1', status: 'ACTIVE' } },
      status: 'connected',
    });
    expect(mocks.connectorToolUpsertMany).toHaveBeenCalledWith('conn-new', [
      expect.objectContaining({ toolName: 'GMAIL_SEND' }),
    ]);
    // authoritative refresh prunes to exactly the provided set
    expect(mocks.connectorToolDeleteToolsNotIn).toHaveBeenCalledWith('conn-new', ['GMAIL_SEND']);
  });

  it('updates an existing connector projection instead of duplicating it', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().updateComposioPlugin(input);

    expect(mocks.connectorCreate).not.toHaveBeenCalled();
    expect(mocks.connectorUpdate).toHaveBeenCalledWith(
      'conn-existing',
      expect.objectContaining({
        metadata: expect.objectContaining({
          composio: expect.objectContaining({ status: 'ACTIVE' }),
        }),
        status: 'connected',
      }),
    );
    expect(mocks.connectorToolUpsertMany).toHaveBeenCalledWith('conn-existing', expect.any(Array));
    expect(mocks.connectorToolDeleteToolsNotIn).toHaveBeenCalledWith('conn-existing', [
      'GMAIL_SEND',
    ]);
  });

  it('prunes all connector tools when the refreshed list is empty', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().updateComposioPlugin({ ...input, tools: [] });

    // nothing to upsert, but the stale set is fully cleared
    expect(mocks.connectorToolUpsertMany).not.toHaveBeenCalled();
    expect(mocks.connectorToolDeleteToolsNotIn).toHaveBeenCalledWith('conn-existing', []);
  });
});

describe('composioRouter delete paths clean up the connector projection', () => {
  it('removeComposioPlugin deletes the connector row when present', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().removeComposioPlugin({ identifier: 'gmail' });

    expect(mocks.pluginDelete).toHaveBeenCalledWith('gmail');
    expect(mocks.connectorDelete).toHaveBeenCalledWith('conn-existing');
  });

  it('deleteConnection deletes both plugin and connector', async () => {
    mocks.connectedAccountsDelete.mockResolvedValue(undefined);
    mocks.connectorFindScopedByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().deleteConnection({ connectedAccountId: 'ca-1', identifier: 'gmail' });

    expect(mocks.pluginDelete).toHaveBeenCalledWith('gmail');
    expect(mocks.connectorDelete).toHaveBeenCalledWith('conn-existing');
  });

  it('does not call connector delete when no projection exists', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue(null);

    await caller().removeComposioPlugin({ identifier: 'gmail' });

    expect(mocks.connectorDelete).not.toHaveBeenCalled();
  });
});
