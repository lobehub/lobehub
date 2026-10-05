import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorOAuthError } from '@/utils/connectorOAuth';

import { executeOAuthCreate } from './oauthCreate';

const deps = {
  createConnector: vi.fn(),
  deleteConnector: vi.fn(),
  isConnectorConnected: vi.fn(),
  startConnectorOAuth: vi.fn(),
  waitForConnectorOAuth: vi.fn(),
};
const popup = {} as Window;

describe('executeOAuthCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.deleteConnector.mockResolvedValue(undefined);
    deps.isConnectorConnected.mockResolvedValue(false);
  });

  it('opens the authorize URL for the created connector', async () => {
    deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });
    deps.startConnectorOAuth.mockResolvedValue('https://auth.example.com/authorize');
    deps.waitForConnectorOAuth.mockResolvedValue(undefined);

    await executeOAuthCreate({ identifier: 'example' }, popup, deps);

    expect(deps.startConnectorOAuth).toHaveBeenCalledWith('c1');
    expect(deps.waitForConnectorOAuth).toHaveBeenCalledWith(
      popup,
      'c1',
      'https://auth.example.com/authorize',
    );
    expect(deps.deleteConnector).not.toHaveBeenCalled();
  });

  it('rolls back a newly created connector when the OAuth flow cannot start', async () => {
    // Regression: a rejected dynamic registration left a disconnected,
    // tool-less connector behind after the "install failed" toast.
    deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });
    deps.startConnectorOAuth.mockRejectedValue(new Error('registration rejected'));

    await expect(executeOAuthCreate({}, popup, deps)).rejects.toThrow('registration rejected');

    expect(deps.deleteConnector).toHaveBeenCalledWith('c1');
    expect(deps.waitForConnectorOAuth).not.toHaveBeenCalled();
  });

  it('surfaces the original error even when the rollback fails', async () => {
    deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });
    deps.startConnectorOAuth.mockRejectedValue(new Error('registration rejected'));
    deps.deleteConnector.mockRejectedValue(new Error('network'));

    await expect(executeOAuthCreate({}, popup, deps)).rejects.toThrow('registration rejected');
  });

  it('never deletes a connector that already existed before this attempt', async () => {
    deps.createConnector.mockResolvedValue({ id: 'c1', isNew: false });
    deps.startConnectorOAuth.mockRejectedValue(new Error('registration rejected'));

    await expect(executeOAuthCreate({}, popup, deps)).rejects.toThrow();

    expect(deps.deleteConnector).not.toHaveBeenCalled();
  });

  it('keeps the connector once the popup was navigated, even if the result is lost', async () => {
    deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });
    deps.startConnectorOAuth.mockResolvedValue('https://auth.example.com/authorize');
    deps.waitForConnectorOAuth.mockRejectedValue(new Error('dismissed'));

    await expect(executeOAuthCreate({}, popup, deps)).rejects.toThrow('dismissed');

    expect(deps.deleteConnector).not.toHaveBeenCalled();
  });

  describe('when the popup closes without reporting a result', () => {
    beforeEach(() => {
      deps.startConnectorOAuth.mockResolvedValue('https://auth.example.com/authorize');
      deps.waitForConnectorOAuth.mockRejectedValue(new ConnectorOAuthError('dismissed'));
    });

    it('succeeds when the callback already connected the new connector', async () => {
      // Regression: a COOP provider severed window.opener, so a successful
      // authorization was reported to the user as "canceled".
      deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });
      deps.isConnectorConnected.mockResolvedValue(true);

      await expect(executeOAuthCreate({}, popup, deps)).resolves.toBeUndefined();

      expect(deps.isConnectorConnected).toHaveBeenCalledWith('c1');
    });

    it('stays canceled when the new connector is still not connected', async () => {
      deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });

      await expect(executeOAuthCreate({}, popup, deps)).rejects.toMatchObject({
        reason: 'dismissed',
      });
    });

    it('stays canceled when the status check itself fails', async () => {
      deps.createConnector.mockResolvedValue({ id: 'c1', isNew: true });
      deps.isConnectorConnected.mockRejectedValue(new Error('network'));

      await expect(executeOAuthCreate({}, popup, deps)).rejects.toMatchObject({
        reason: 'dismissed',
      });
    });

    it('does not trust the status of a connector that existed before', async () => {
      deps.createConnector.mockResolvedValue({ id: 'c1', isNew: false });
      deps.isConnectorConnected.mockResolvedValue(true);

      await expect(executeOAuthCreate({}, popup, deps)).rejects.toMatchObject({
        reason: 'dismissed',
      });
      expect(deps.isConnectorConnected).not.toHaveBeenCalled();
    });
  });
});
