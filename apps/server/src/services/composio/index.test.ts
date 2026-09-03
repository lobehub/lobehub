import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioService } from './index';

const mocks = vi.hoisted(() => ({
  connectorQuery: vi.fn(),
  connectorQueryByIdentifiers: vi.fn(),
  connectorToolQueryAll: vi.fn(),
  isClientAvailable: vi.fn(),
  isComposioNotFound: vi.fn(),
  markComposioUnavailable: vi.fn(),
  pluginFindById: vi.fn(),
  pluginQuery: vi.fn(),
  toolsExecute: vi.fn(),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    // Runtime resolution goes through the agent-aware resolvers; map them to the
    // same fixtures (the priority/dedup logic itself is covered by the model's
    // own connectorAgentScope tests).
    resolveAll: mocks.connectorQuery,
    resolveByIdentifiers: mocks.connectorQueryByIdentifiers,
    markComposioConnectionUnavailable: mocks.markComposioUnavailable,
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    queryAllByConnectorIds: mocks.connectorToolQueryAll,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    findById: mocks.pluginFindById,
    query: mocks.pluginQuery,
  })),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({ tools: { execute: mocks.toolsExecute } }),
  isComposioClientAvailable: mocks.isClientAvailable,
  isComposioConnectedAccountNotFoundError: mocks.isComposioNotFound,
}));

const service = () => new ComposioService({ db: {} as any, userId: 'user-1' });

const activeConnectorRow = (overrides: Record<string, any> = {}) => ({
  id: 'conn-gmail',
  identifier: 'gmail',
  isEnabled: true,
  metadata: {
    avatar: '🔌',
    composio: { appSlug: 'GMAIL', connectedAccountId: 'ca-connector', status: 'ACTIVE' },
  },
  name: 'Gmail',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClientAvailable.mockReturnValue(true);
  mocks.isComposioNotFound.mockImplementation(
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'CONNECTED_ACCOUNT_NOT_FOUND',
  );
  mocks.markComposioUnavailable.mockResolvedValue(false);
  mocks.connectorQuery.mockResolvedValue([]);
  mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
  mocks.connectorToolQueryAll.mockResolvedValue([]);
  mocks.pluginQuery.mockResolvedValue([]);
  mocks.pluginFindById.mockResolvedValue(undefined);
});

describe('ComposioService.getComposioManifests', () => {
  it('builds manifests from connector rows + connector tools (new path)', async () => {
    mocks.connectorQuery.mockResolvedValue([activeConnectorRow()]);
    mocks.connectorToolQueryAll.mockResolvedValue([
      {
        description: 'Send an email',
        inputSchema: { properties: { to: {} }, type: 'object' },
        toolName: 'GMAIL_SEND_EMAIL',
        userConnectorId: 'conn-gmail',
      },
    ]);

    const manifests = await service().getComposioManifests();

    expect(manifests).toHaveLength(1);
    expect(manifests[0].identifier).toBe('gmail');
    expect(manifests[0].api).toHaveLength(1);
    expect(manifests[0].api[0].name).toBe('GMAIL_SEND_EMAIL');
    expect(manifests[0].api[0].parameters).toEqual({ properties: { to: {} }, type: 'object' });
    // Plugin table must NOT be consulted once the connector covers the identifier.
    expect(mocks.pluginQuery).toHaveBeenCalledTimes(1); // called, but yields nothing new
  });

  it('falls back to plugin table for identifiers without a connector projection', async () => {
    mocks.connectorQuery.mockResolvedValue([]);
    mocks.pluginQuery.mockResolvedValue([
      {
        customParams: { composio: { status: 'ACTIVE' } },
        identifier: 'slack',
        manifest: {
          api: [{ description: 'post', name: 'SLACK_POST', parameters: { type: 'object' } }],
          meta: { avatar: '☁️', title: 'Slack' },
        },
      },
    ]);

    const manifests = await service().getComposioManifests();

    expect(manifests).toHaveLength(1);
    expect(manifests[0].identifier).toBe('slack');
    expect(manifests[0].api[0].name).toBe('SLACK_POST');
  });

  it('unions both sources and dedupes by identifier (connector wins)', async () => {
    mocks.connectorQuery.mockResolvedValue([activeConnectorRow()]);
    mocks.connectorToolQueryAll.mockResolvedValue([
      { toolName: 'GMAIL_SEND_EMAIL', userConnectorId: 'conn-gmail' },
    ]);
    mocks.pluginQuery.mockResolvedValue([
      // Same identifier as the connector → must be dropped (connector wins).
      {
        customParams: { composio: { status: 'ACTIVE' } },
        identifier: 'gmail',
        manifest: { api: [{ name: 'GMAIL_OLD' }], meta: {} },
      },
      // Distinct identifier → included via fallback.
      {
        customParams: { composio: { status: 'ACTIVE' } },
        identifier: 'slack',
        manifest: { api: [{ name: 'SLACK_POST' }], meta: {} },
      },
    ]);

    const manifests = await service().getComposioManifests();

    expect(manifests.map((m) => m.identifier).sort()).toEqual(['gmail', 'slack']);
    const gmail = manifests.find((m) => m.identifier === 'gmail')!;
    // connector version (GMAIL_SEND_EMAIL), not the plugin's GMAIL_OLD
    expect(gmail.api[0].name).toBe('GMAIL_SEND_EMAIL');
  });

  it('ignores connector rows that are not ACTIVE or are disabled', async () => {
    mocks.connectorQuery.mockResolvedValue([
      activeConnectorRow({ metadata: { composio: { status: 'PENDING' } } }),
      activeConnectorRow({ id: 'c2', identifier: 'jira', isEnabled: false }),
    ]);

    const manifests = await service().getComposioManifests();

    expect(manifests).toHaveLength(0);
  });

  /** @example Legacy GitHub Composio rows are not exposed after Market becomes canonical. */
  it('ignores connector rows removed from the Composio catalog', async () => {
    mocks.connectorQuery.mockResolvedValue([
      activeConnectorRow({ id: 'conn-github', identifier: 'github', name: 'GitHub' }),
    ]);

    await expect(service().getComposioManifests()).resolves.toEqual([]);
    expect(mocks.connectorToolQueryAll).not.toHaveBeenCalled();
  });

  it('returns empty when there are no composio connections in either source', async () => {
    const manifests = await service().getComposioManifests();
    expect(manifests).toEqual([]);
  });
});

describe('ComposioService.executeComposioTool', () => {
  const params = { args: { to: 'a@b.c' }, identifier: 'gmail', toolSlug: 'GMAIL_SEND_EMAIL' };

  /** @example Legacy GitHub Composio tools cannot execute after Market becomes canonical. */
  it('rejects apps removed from the Composio catalog', async () => {
    const result = await service().executeComposioTool({
      args: {},
      identifier: 'github',
      toolSlug: 'GITHUB_GET_REPOSITORY',
    });

    expect(result).toMatchObject({ error: { code: 'COMPOSIO_APP_UNSUPPORTED' }, success: false });
    expect(mocks.connectorQueryByIdentifiers).not.toHaveBeenCalled();
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });

  it('returns COMPOSIO_NOT_CONFIGURED when the client is unavailable', async () => {
    mocks.isClientAvailable.mockReturnValue(false);

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMPOSIO_NOT_CONFIGURED');
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });

  it('resolves connectedAccountId from connector metadata (new path)', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([activeConnectorRow()]);
    mocks.toolsExecute.mockResolvedValue({ data: 'sent' });

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(true);
    expect(result.content).toBe('sent');
    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'user-1' }),
    );
    // connector hit → plugin fallback not consulted
    expect(mocks.pluginFindById).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(connector.status).toBe('error');
   */
  it('delegates a connected-account 404 to ConnectorModel after tool execution fails', async () => {
    const notFound = Object.assign(new Error('connected account not found'), {
      code: 'CONNECTED_ACCOUNT_NOT_FOUND',
    });
    mocks.connectorQueryByIdentifiers.mockResolvedValue([activeConnectorRow()]);
    mocks.toolsExecute.mockRejectedValue(notFound);
    mocks.markComposioUnavailable.mockResolvedValue(true);

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(false);
    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('conn-gmail', 'ca-connector');
  });

  /**
   * @example
   * expect(connector.status).toBe('connected');
   */
  it('does not disable a connector when a tool reports a remote resource 404', async () => {
    // ROOT CAUSE:
    //
    // A generic HTTP 404 can mean the requested email, repository, or other provider resource is
    // missing. Treating every 404 as a missing Composio connected account disabled healthy connectors.
    // We now require Composio's explicit connected-account-not-found classification at this boundary.
    mocks.connectorQueryByIdentifiers.mockResolvedValue([activeConnectorRow()]);
    mocks.toolsExecute.mockRejectedValue(
      Object.assign(new Error('repository not found'), { status: 404 }),
    );

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(false);
    expect(mocks.markComposioUnavailable).not.toHaveBeenCalled();
  });

  it('executes under the account OWNER entity, not the caller (workspace-shared connector)', async () => {
    // Regression: a workspace member runs a shared agent whose Composio connector
    // was linked by another user (openomy). buildWorkspaceWhere resolves that
    // owner's row; the connected account is bound to the owner's Composio entity,
    // so execute MUST pass the owner's userId — passing the caller's ('user-1')
    // failed Composio's account/entity validation ("Error executing the tool").
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      activeConnectorRow({ userId: 'owner-openomy' }),
    ]);
    mocks.toolsExecute.mockResolvedValue({ data: 'sent' });

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(true);
    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'owner-openomy' }),
    );
  });

  it('prefers metadata.composio.linkedByUserId over the row creator (owner reconnected a member row)', async () => {
    // A workspace owner reconnected Gmail on a member-created connector row:
    // upsertComposioConnector refreshes metadata (incl. linkedByUserId=owner) but
    // keeps userId=member (the row creator, for manage-rights). The account is now
    // linked under the owner, so execute must run under linkedByUserId, NOT userId.
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      activeConnectorRow({
        metadata: {
          composio: {
            connectedAccountId: 'ca-connector',
            linkedByUserId: 'owner-reconnector',
            status: 'ACTIVE',
          },
        },
        userId: 'member-creator',
      }),
    ]);
    mocks.toolsExecute.mockResolvedValue({ data: 'sent' });

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(true);
    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'owner-reconnector' }),
    );
  });

  it('falls back to plugin customParams when the connector has no account', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
    mocks.pluginFindById.mockResolvedValue({
      customParams: { composio: { connectedAccountId: 'ca-plugin' } },
      userId: 'owner-plugin',
    });
    mocks.toolsExecute.mockResolvedValue({ data: 'sent' });

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(true);
    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-plugin', userId: 'owner-plugin' }),
    );
  });

  it('returns COMPOSIO_CONFIG_NOT_FOUND when neither source has an account', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
    mocks.pluginFindById.mockResolvedValue(undefined);

    const result = await service().executeComposioTool(params);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMPOSIO_CONFIG_NOT_FOUND');
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });
});
