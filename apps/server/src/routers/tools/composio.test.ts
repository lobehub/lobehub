// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composioToolsRouter } from './composio';

const mocks = vi.hoisted(() => ({
  connectorQueryByIdentifiers: vi.fn(),
  isComposioNotFound: vi.fn(),
  markComposioUnavailable: vi.fn(),
  pluginFindById: vi.fn(),
  processToolCallResult: vi.fn(),
  toolsExecute: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    markComposioConnectionUnavailable: mocks.markComposioUnavailable,
    queryByIdentifiers: mocks.connectorQueryByIdentifiers,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({ findById: mocks.pluginFindById })),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({ tools: { execute: mocks.toolsExecute } }),
  isComposioConnectedAccountNotFoundError: mocks.isComposioNotFound,
}));

vi.mock('@/server/services/mcp', () => ({
  MCPService: { processToolCallResult: mocks.processToolCallResult },
}));

const caller = () => composioToolsRouter.createCaller({ userId: 'user-1' } as any);
const input = { identifier: 'gmail', toolArgs: { to: 'a@b.c' }, toolSlug: 'GMAIL_SEND_EMAIL' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
  mocks.isComposioNotFound.mockImplementation(
    (error: unknown) =>
      typeof error === 'object' && error !== null && 'status' in error && error.status === 404,
  );
  mocks.markComposioUnavailable.mockResolvedValue(false);
  mocks.pluginFindById.mockResolvedValue(undefined);
  mocks.toolsExecute.mockResolvedValue({ data: 'ok' });
  mocks.processToolCallResult.mockResolvedValue({ content: 'ok', success: true });
});

describe('composioToolsRouter.executeAction', () => {
  it('resolves connectedAccountId from connector metadata (new path)', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'user-1' }),
    );
    expect(mocks.pluginFindById).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(connector.status).toBe('error');
   */
  it('delegates a connected-account 404 to ConnectorModel for manual execution', async () => {
    const notFound = Object.assign(new Error('connected account not found'), { status: 404 });
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      { id: 'conn-gmail', metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);
    mocks.toolsExecute.mockRejectedValue(notFound);
    mocks.markComposioUnavailable.mockResolvedValue(true);

    await expect(caller().executeAction(input)).rejects.toMatchObject({
      message: 'connected account not found',
    });
    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('conn-gmail');
  });

  it('falls back to plugin customParams when no connector projection exists', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
    mocks.pluginFindById.mockResolvedValue({
      customParams: { composio: { connectedAccountId: 'ca-plugin' } },
    });

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-plugin' }),
    );
  });

  it('throws NOT_FOUND when neither source has a connection', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
    mocks.pluginFindById.mockResolvedValue(undefined);

    await expect(caller().executeAction(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });
});
