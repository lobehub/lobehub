import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getConnectorLocalCallToken } from './localCallToken';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('./tokens', () => ({ ensureFreshConnectorToken: vi.fn(async (connector) => connector) }));

const oauthConnector = {
  credentials: {
    accessToken: 'access',
    clientSecret: 'never-leaves',
    refreshToken: 'never-leaves',
    type: 'oauth2',
  },
  id: 'c1',
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
  metadata: { connectVia: 'device' },
  userId: 'u1',
};

const call = (connector: Record<string, unknown> | undefined, userId = 'u1') => {
  const connectorModel = { findById: vi.fn().mockResolvedValue(connector) };
  return getConnectorLocalCallToken({ connectorModel: connectorModel as never, userId }, 'c1');
};

describe('getConnectorLocalCallToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only a device-routed connector's access token, refreshed first when due", async () => {
    vi.mocked(ensureFreshConnectorToken).mockResolvedValueOnce({
      ...oauthConnector,
      credentials: { ...oauthConnector.credentials, accessToken: 'refreshed' },
    } as never);

    await expect(call(oauthConnector)).resolves.toEqual({
      accessToken: 'refreshed',
      type: 'oauth2',
    });
    expect(ensureFreshConnectorToken).toHaveBeenCalledOnce();
  });

  it('returns the token for a localhost / LAN endpoint on automatic routing', async () => {
    await expect(
      call({ ...oauthConnector, mcpServerUrl: 'http://192.168.1.5/mcp', metadata: {} }),
    ).resolves.toEqual({ accessToken: 'access', type: 'oauth2' });
  });

  // The server calls it itself: the token never needs to leave it
  it('returns nothing for a connector the server reaches itself', async () => {
    await expect(call({ ...oauthConnector, metadata: {} })).resolves.toBeNull();
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
  });

  it('returns nothing for a connector without an OAuth token', async () => {
    await expect(
      call({ ...oauthConnector, credentials: { token: 't', type: 'bearer' } }),
    ).resolves.toBeNull();
  });

  // A workspace owner may manage the row, but not take another member's token
  it('refuses anyone but the member who connected it', async () => {
    await expect(call(oauthConnector, 'workspace-owner')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
  });

  it('fails when the connector is gone', async () => {
    await expect(call(undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
