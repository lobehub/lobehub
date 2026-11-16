import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreConnector } from '@/store/tool/slices/connector/replaceConnector';
import type * as ConnectorOAuthModule from '@/utils/connectorOAuth';
import { ConnectorOAuthError, waitForConnectorOAuth } from '@/utils/connectorOAuth';

import { saveOAuthConnectorEdit } from './oauthEdit';

vi.mock('@/store/tool/slices/connector/replaceConnector', () => ({
  restoreConnector: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/connectorOAuth', async (original) => ({
  ...(await original<typeof ConnectorOAuthModule>()),
  waitForConnectorOAuth: vi.fn(),
}));

const previous = { id: 'c1', mcpServerUrl: 'https://old.example.com', status: 'connected' };
const patch = {
  credentials: null,
  mcpServerUrl: 'https://new.example.com',
  oidcConfig: { scheme: 'dcr' as const },
};
const popup = { close: vi.fn() } as unknown as Window;

const makeStore = (statusAfterPopup: string) => {
  const state = {
    connectors: [] as Record<string, unknown>[],
    fetchConnectors: vi.fn(async () => {
      state.connectors = [{ id: 'c1', status: statusAfterPopup }];
    }),
    getConnectorForEdit: vi.fn().mockResolvedValue(previous),
    startConnectorOAuth: vi.fn().mockResolvedValue('https://auth.example.com/authorize'),
    syncConnectorTools: vi.fn().mockResolvedValue(undefined),
    updateConnector: vi.fn().mockResolvedValue(undefined),
  };
  return { get: () => state as never, state };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(waitForConnectorOAuth).mockResolvedValue(undefined);
});

describe('saveOAuthConnectorEdit', () => {
  it('stores the edit, then authorizes it', async () => {
    const { get, state } = makeStore('connected');

    await saveOAuthConnectorEdit('c1', patch, popup, get);

    expect(state.updateConnector).toHaveBeenCalledWith('c1', patch);
    expect(waitForConnectorOAuth).toHaveBeenCalledWith(
      popup,
      'c1',
      'https://auth.example.com/authorize',
    );
    expect(restoreConnector).not.toHaveBeenCalled();
  });

  // The callback's sync only adds tools: the edited endpoint's list replaces them
  it('lists the tools again once the edit is authorized, dropping the ones it no longer has', async () => {
    const { get, state } = makeStore('connected');

    await saveOAuthConnectorEdit('c1', patch, popup, get);

    expect(state.syncConnectorTools).toHaveBeenCalledWith('c1', { pruneMissingAutoTools: true });
    expect(state.syncConnectorTools.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(waitForConnectorOAuth).mock.invocationCallOrder[0],
    );
  });

  it('keeps an authorized edit when listing its tools again fails', async () => {
    const { get, state } = makeStore('connected');
    state.syncConnectorTools.mockRejectedValueOnce(new Error('unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(saveOAuthConnectorEdit('c1', patch, popup, get)).resolves.toBeUndefined();
    expect(restoreConnector).not.toHaveBeenCalled();
  });

  // The edit already pointed the connector at the new endpoint: its tools must
  // not keep running there unauthorized
  it.each([
    ['dismissed', new ConnectorOAuthError('dismissed')],
    ['denied', new ConnectorOAuthError('failed')],
    ['timed out', new ConnectorOAuthError('timeout')],
  ])('puts the connector back when authorization is %s', async (_, error) => {
    const { get, state } = makeStore('disconnected');
    vi.mocked(waitForConnectorOAuth).mockRejectedValueOnce(error);

    await expect(saveOAuthConnectorEdit('c1', patch, popup, get)).rejects.toBe(error);
    expect(state.syncConnectorTools).not.toHaveBeenCalled();

    // Read before the edit is stored
    expect(state.getConnectorForEdit.mock.invocationCallOrder[0]).toBeLessThan(
      state.updateConnector.mock.invocationCallOrder[0],
    );
    expect(restoreConnector).toHaveBeenCalledWith(previous, get);
  });

  it('puts the connector back when authorization cannot start', async () => {
    const { get, state } = makeStore('disconnected');
    state.startConnectorOAuth.mockRejectedValueOnce(new Error('Registration rejected'));

    await expect(saveOAuthConnectorEdit('c1', patch, popup, get)).rejects.toThrow(
      'Registration rejected',
    );
    expect(restoreConnector).toHaveBeenCalledWith(previous, get);
  });

  it('keeps the edit when the callback connected the row but its message was lost', async () => {
    // A COOP provider severs window.opener; the stored edit left the row
    // disconnected, so only this callback can have connected it
    const { get } = makeStore('connected');
    vi.mocked(waitForConnectorOAuth).mockRejectedValueOnce(new ConnectorOAuthError('dismissed'));

    await expect(saveOAuthConnectorEdit('c1', patch, popup, get)).resolves.toBeUndefined();
    expect(restoreConnector).not.toHaveBeenCalled();
  });

  it('still reports the original failure when the restore fails', async () => {
    const { get } = makeStore('disconnected');
    const error = new ConnectorOAuthError('failed');
    vi.mocked(waitForConnectorOAuth).mockRejectedValueOnce(error);
    vi.mocked(restoreConnector).mockRejectedValueOnce(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(saveOAuthConnectorEdit('c1', patch, popup, get)).rejects.toBe(error);
  });
});
