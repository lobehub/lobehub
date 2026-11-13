// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composioToolsRouter } from './composio';

const mocks = vi.hoisted(() => ({
  connectorForRow: vi.fn(),
  connectorPickLegacyMirrors: vi.fn(),
  connectorResolveByIdentifiers: vi.fn(),
  isComposioNotFound: vi.fn(),
  markComposioUnavailable: vi.fn(),
  pluginQueryMirrors: vi.fn(),
  processToolCallResult: vi.fn(),
  toolsExecute: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    const model: Record<string, unknown> = {
      forRow: mocks.connectorForRow,
      pickLegacyComposioMirrors: mocks.connectorPickLegacyMirrors,
      markComposioConnectionUnavailable: mocks.markComposioUnavailable,
      resolveByIdentifiers: mocks.connectorResolveByIdentifiers,
    };
    mocks.connectorForRow.mockReturnValue(model);
    return model;
  }),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return { queryComposioMirrors: mocks.pluginQueryMirrors };
  }),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({ tools: { execute: mocks.toolsExecute } }),
  isComposioClientAvailable: () => true,
  isComposioConnectedAccountNotFoundError: mocks.isComposioNotFound,
}));

vi.mock('@/server/services/mcp', () => ({
  MCPService: { processToolCallResult: mocks.processToolCallResult },
}));

const caller = () => composioToolsRouter.createCaller({ userId: 'user-1' } as any);
const input = { identifier: 'gmail', toolArgs: { to: 'a@b.c' }, toolSlug: 'GMAIL_SEND_EMAIL' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorResolveByIdentifiers.mockResolvedValue([]);
  mocks.connectorPickLegacyMirrors.mockImplementation(async (mirrors: unknown[]) => mirrors);
  mocks.isComposioNotFound.mockImplementation(function (error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'CONNECTED_ACCOUNT_NOT_FOUND'
    );
  });
  mocks.markComposioUnavailable.mockResolvedValue(false);
  mocks.pluginQueryMirrors.mockResolvedValue([]);
  mocks.toolsExecute.mockResolvedValue({ data: 'ok' });
  mocks.processToolCallResult.mockResolvedValue({ content: 'ok', success: true });
});

describe('composioToolsRouter.executeAction', () => {
  it('resolves connectedAccountId from connector metadata (new path)', async () => {
    mocks.connectorResolveByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'user-1' }),
    );
    // No conversation is named, so only the rows any run may use resolve.
    expect(mocks.connectorResolveByIdentifiers).toHaveBeenCalledWith(['gmail'], {});
    expect(mocks.pluginQueryMirrors).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(connector.status).toBe('error');
   */
  it('delegates a connected-account 404 to ConnectorModel for manual execution', async () => {
    const notFound = Object.assign(new Error('connected account not found'), {
      code: 'CONNECTED_ACCOUNT_NOT_FOUND',
    });
    mocks.connectorResolveByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);
    mocks.toolsExecute.mockRejectedValue(notFound);
    mocks.markComposioUnavailable.mockResolvedValue(true);

    await expect(caller().executeAction(input)).rejects.toMatchObject({
      message: 'connected account not found',
    });
    expect(mocks.connectorForRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-gmail' }),
    );
    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('conn-gmail', 'ca-connector');
  });

  /**
   * @example
   * expect(connector.status).toBe('connected');
   */
  it('does not disable a connector when manual execution reports a remote resource 404', async () => {
    // ROOT CAUSE:
    //
    // Tool actions can return 404 for the target resource while their connected account is healthy.
    // Only Composio's explicit connected-account-not-found error may update connector health here.
    mocks.connectorResolveByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);
    mocks.toolsExecute.mockRejectedValue(
      Object.assign(new Error('message not found'), { status: 404 }),
    );

    await expect(caller().executeAction(input)).rejects.toMatchObject({
      message: 'message not found',
    });
    expect(mocks.markComposioUnavailable).not.toHaveBeenCalled();
  });

  it('falls back to plugin customParams when no connector projection exists', async () => {
    mocks.connectorResolveByIdentifiers.mockResolvedValue([]);
    mocks.pluginQueryMirrors.mockResolvedValue([
      {
        customParams: { composio: { connectedAccountId: 'ca-plugin' } },
        identifier: 'gmail',
        userId: 'user-2',
      },
    ]);

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-plugin' }),
    );
  });

  /**
   * @example
   * expect(executeAction()).rejects.toMatchObject({ code: 'NOT_FOUND' });
   */
  it('does not run the plugin mirror of a connector the caller cannot see', async () => {
    // ROOT CAUSE:
    //
    // The shared-row lookup misses a connector its creator made private, and the route read
    // that miss as a pre-connector legacy connection. The workspace-wide plugin projection
    // still mirrors the account, so any member ran it as the creator's Composio entity.
    mocks.connectorResolveByIdentifiers.mockResolvedValue([]);
    mocks.connectorPickLegacyMirrors.mockResolvedValue([]);
    mocks.pluginQueryMirrors.mockResolvedValue([
      {
        customParams: { composio: { connectedAccountId: 'ca-private', linkedByUserId: 'user-2' } },
        identifier: 'gmail',
        userId: 'user-2',
      },
    ]);

    await expect(caller().executeAction(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.pluginQueryMirrors).toHaveBeenCalledWith(['gmail']);
    expect(mocks.connectorPickLegacyMirrors).toHaveBeenCalledWith([
      expect.objectContaining({
        connectedAccountId: 'ca-private',
        identifier: 'gmail',
        ownerUserId: 'user-2',
      }),
    ]);
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when neither source has a connection', async () => {
    mocks.connectorResolveByIdentifiers.mockResolvedValue([]);

    await expect(caller().executeAction(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });
});
