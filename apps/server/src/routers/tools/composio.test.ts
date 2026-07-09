// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composioToolsRouter } from './composio';

const mocks = vi.hoisted(() => ({
  connectorQueryByIdentifiers: vi.fn(),
  pluginFindById: vi.fn(),
  processToolCallResult: vi.fn(),
  toolsExecute: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    queryByIdentifiers: mocks.connectorQueryByIdentifiers,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({ findById: mocks.pluginFindById })),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({ tools: { execute: mocks.toolsExecute } }),
}));

vi.mock('@/server/services/mcp', () => ({
  MCPService: { processToolCallResult: mocks.processToolCallResult },
}));

const caller = () => composioToolsRouter.createCaller({ userId: 'user-1' } as any);
const input = { identifier: 'gmail', toolArgs: { to: 'a@b.c' }, toolSlug: 'GMAIL_SEND_EMAIL' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorQueryByIdentifiers.mockResolvedValue([]);
  mocks.pluginFindById.mockResolvedValue(undefined);
  mocks.toolsExecute.mockResolvedValue({ data: 'ok' });
  mocks.processToolCallResult.mockResolvedValue({ content: 'ok', success: true });
});

describe('composioToolsRouter.executeAction', () => {
  it('resolves connectedAccountId from connector metadata (new path)', async () => {
    mocks.connectorQueryByIdentifiers.mockResolvedValue([
      { metadata: { composio: { connectedAccountId: 'ca-connector' } } },
    ]);

    await caller().executeAction(input);

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'ca-connector', userId: 'user-1' }),
    );
    expect(mocks.pluginFindById).not.toHaveBeenCalled();
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
