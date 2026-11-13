// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composioRouter } from './composio';

const mocks = vi.hoisted(() => ({
  // composio client
  authConfigsCreate: vi.fn(),
  authConfigsList: vi.fn(),
  connectedAccountsDelete: vi.fn(),
  connectedAccountsGet: vi.fn(),
  connectedAccountsLink: vi.fn(),
  connectedAccountsList: vi.fn(),
  connectorCreate: vi.fn(),
  connectorDelete: vi.fn(),
  connectorFindManageableByIdentifier: vi.fn(),
  connectorFindScopedByIdentifier: vi.fn(),
  connectorQueryComposioAccountHolders: vi.fn(),
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
  pluginQueryComposioMirrors: vi.fn(),
  pluginUpdate: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/config/composio', () => ({
  getServerComposioAuthConfigId: mocks.getServerComposioAuthConfigId,
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      create: mocks.pluginCreate,
      delete: mocks.pluginDelete,
      findById: mocks.pluginFindById,
      queryComposioMirrors: mocks.pluginQueryComposioMirrors,
      update: mocks.pluginUpdate,
    };
  }),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    return {
      create: mocks.connectorCreate,
      delete: mocks.connectorDelete,
      findManageableByIdentifier: mocks.connectorFindManageableByIdentifier,
      findScopedByIdentifier: mocks.connectorFindScopedByIdentifier,
      queryComposioAccountHolders: mocks.connectorQueryComposioAccountHolders,
      update: mocks.connectorUpdate,
    };
  }),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(function () {
    return {
      deleteToolsNotIn: mocks.connectorToolDeleteToolsNotIn,
      upsertMany: mocks.connectorToolUpsertMany,
    };
  }),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    authConfigs: { create: mocks.authConfigsCreate, list: mocks.authConfigsList },
    connectedAccounts: {
      delete: mocks.connectedAccountsDelete,
      get: mocks.connectedAccountsGet,
      link: mocks.connectedAccountsLink,
      list: mocks.connectedAccountsList,
    },
    tools: { getRawComposioTools: mocks.getRawComposioTools },
  }),
}));

const caller = () => composioRouter.createCaller({ userId: 'user-1' } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorFindManageableByIdentifier.mockResolvedValue(null);
  mocks.connectorCreate.mockResolvedValue({ id: 'conn-new' });
  mocks.pluginFindById.mockResolvedValue(undefined);
  mocks.pluginQueryComposioMirrors.mockResolvedValue([]);
  // By default the account a write names is held by the row the write resolves
  // (the implementation is read without recording a lookup call).
  mocks.connectorQueryComposioAccountHolders.mockImplementation(async () => {
    const row = await mocks.connectorFindManageableByIdentifier.getMockImplementation()?.();
    return row ? [{ agentId: null, userId: 'user-1', visibility: 'public', ...row }] : [];
  });
});

/** The plugin projection row of a legacy connection, which no connector row runs. */
const legacyMirror = (connectedAccountId: string) => ({
  customParams: { composio: { connectedAccountId } },
  identifier: 'gmail',
  userId: 'user-1',
});

/** @example OAuth callback polling reports whether Gmail can be read. */
describe('composioRouter.getConnection', () => {
  /** @example An ACTIVE Gmail account with read-only scope is marked readable. */
  it('returns confirmed Gmail read permission', async () => {
    const account = {
      data: {
        email: 'ada@example.com',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
      id: 'ca-1',
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
    };
    mocks.connectedAccountsGet.mockResolvedValue(account);
    mocks.connectedAccountsList.mockResolvedValue({ items: [account] });

    await expect(caller().getConnection({ connectedAccountId: 'ca-1' })).resolves.toMatchObject({
      connectedAccountId: 'ca-1',
      gmailReadPermission: true,
      status: 'ACTIVE',
    });
  });

  /** @example An ACTIVE Gmail account with identity-only scopes triggers the recovery UI. */
  it('returns missing Gmail read permission', async () => {
    const account = {
      data: {
        email: 'ada@example.com',
        scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
      },
      id: 'ca-1',
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
    };
    mocks.connectedAccountsGet.mockResolvedValue(account);
    mocks.connectedAccountsList.mockResolvedValue({ items: [account] });

    await expect(caller().getConnection({ connectedAccountId: 'ca-1' })).resolves.toMatchObject({
      gmailReadPermission: false,
      status: 'ACTIVE',
    });
  });
});

describe('composioRouter.createConnection dual-write', () => {
  /** @example GitHub cannot create a legacy Composio account after moving to Market OAuth. */
  it('rejects apps removed from the Composio catalog before remote side effects', async () => {
    await expect(
      caller().createConnection({ appSlug: 'GITHUB', identifier: 'github', label: 'GitHub' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.authConfigsList).not.toHaveBeenCalled();
    expect(mocks.connectedAccountsLink).not.toHaveBeenCalled();
    expect(mocks.connectorCreate).not.toHaveBeenCalled();
  });

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
    // A legacy connection: only the plugin projection holds the account.
    mocks.connectorFindManageableByIdentifier.mockResolvedValue(null);
    mocks.pluginQueryComposioMirrors.mockResolvedValue([legacyMirror('ca-1')]);

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

  it('updates the private row a connector was switched to, instead of republishing it', async () => {
    // A refresh resolves the caller's own row in either visibility; missing the
    // private one would create a second, public row for the same account.
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({
      agentId: null,
      id: 'conn-private',
      metadata: { composio: { connectedAccountId: 'ca-1' } },
      userId: 'user-1',
      visibility: 'private',
    });

    await caller().updateComposioPlugin(input);

    expect(mocks.connectorCreate).not.toHaveBeenCalled();
    expect(mocks.connectorUpdate).toHaveBeenCalledWith(
      'conn-private',
      expect.objectContaining({ status: 'connected' }),
    );
  });

  it('updates the row holding the refreshed account, resolved once', async () => {
    // Refreshing the shared account must not overwrite the caller's private
    // connection of the same app: the account picks the row, and the policy
    // check and the update use that same row.
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-shared' });

    await caller().updateComposioPlugin(input);

    expect(mocks.connectorFindManageableByIdentifier).toHaveBeenCalledTimes(1);
    expect(mocks.connectorFindManageableByIdentifier).toHaveBeenCalledWith(
      'gmail',
      undefined,
      'ca-1',
    );
    expect(mocks.connectorUpdate).toHaveBeenCalledWith('conn-shared', expect.anything());
  });

  it('updates an existing connector projection instead of duplicating it', async () => {
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-existing' });

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
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().updateComposioPlugin({ ...input, tools: [] });

    // nothing to upsert, but the stale set is fully cleared
    expect(mocks.connectorToolUpsertMany).not.toHaveBeenCalled();
    expect(mocks.connectorToolDeleteToolsNotIn).toHaveBeenCalledWith('conn-existing', []);
  });
});

describe('composioRouter delete paths clean up the connector projection', () => {
  it('removeComposioPlugin deletes the connector row when present', async () => {
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().removeComposioPlugin({ identifier: 'gmail' });

    expect(mocks.pluginDelete).toHaveBeenCalledWith('gmail');
    expect(mocks.connectorDelete).toHaveBeenCalledWith('conn-existing');
  });

  it('deleteConnection deletes both plugin and connector', async () => {
    mocks.connectedAccountsDelete.mockResolvedValue(undefined);
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-existing' });

    await caller().deleteConnection({ connectedAccountId: 'ca-1', identifier: 'gmail' });

    expect(mocks.pluginDelete).toHaveBeenCalledWith('gmail');
    expect(mocks.connectorDelete).toHaveBeenCalledWith('conn-existing');
  });

  it('deleteConnection removes the row holding the account it deletes', async () => {
    // Regression: the row was looked up by identifier alone, so with a private
    // and a shared connection of the same app, deleting the shared account
    // removed the caller's private row and left the shared one pointing at a
    // deleted account.
    mocks.connectedAccountsDelete.mockResolvedValue(undefined);
    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-shared' });

    await caller().deleteConnection({ connectedAccountId: 'ca-shared', identifier: 'gmail' });

    expect(mocks.connectorFindManageableByIdentifier).toHaveBeenCalledTimes(1);
    expect(mocks.connectorFindManageableByIdentifier).toHaveBeenCalledWith(
      'gmail',
      undefined,
      'ca-shared',
    );
    expect(mocks.connectedAccountsDelete).toHaveBeenCalledWith('ca-shared');
    expect(mocks.connectorDelete).toHaveBeenCalledWith('conn-shared');
  });

  it('deleteConnection removes a legacy connection the plugin projection holds', async () => {
    mocks.pluginQueryComposioMirrors.mockResolvedValue([legacyMirror('ca-legacy')]);

    await caller().deleteConnection({ connectedAccountId: 'ca-legacy', identifier: 'gmail' });

    expect(mocks.pluginQueryComposioMirrors).toHaveBeenCalledWith(['gmail']);
    expect(mocks.connectedAccountsDelete).toHaveBeenCalledWith('ca-legacy');
    expect(mocks.pluginDelete).toHaveBeenCalledWith('gmail');
  });

  it('deleteConnection refuses an account that is none of the connection’s', async () => {
    // The Composio client deletes by account id alone: an account neither a
    // connector row nor the app's plugin projection holds is not the caller's
    // to delete, nor is one another connector runs.
    mocks.pluginQueryComposioMirrors.mockResolvedValue([legacyMirror('ca-legacy')]);

    await expect(
      caller().deleteConnection({ connectedAccountId: 'ca-elsewhere', identifier: 'gmail' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    mocks.connectorFindManageableByIdentifier.mockResolvedValue({ id: 'conn-gmail' });
    mocks.connectorQueryComposioAccountHolders.mockResolvedValue([
      { agentId: null, id: 'conn-github', identifier: 'github', userId: 'user-1' },
    ]);
    await expect(
      caller().deleteConnection({ connectedAccountId: 'ca-github', identifier: 'gmail' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.connectedAccountsDelete).not.toHaveBeenCalled();
    expect(mocks.pluginDelete).not.toHaveBeenCalled();
    expect(mocks.connectorDelete).not.toHaveBeenCalled();
  });

  it('does not call connector delete when no projection exists', async () => {
    mocks.connectorFindManageableByIdentifier.mockResolvedValue(null);

    await caller().removeComposioPlugin({ identifier: 'gmail' });

    expect(mocks.connectorDelete).not.toHaveBeenCalled();
  });
});
