import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getConnectorLocalCallToken, getResolvedConnectorLocalCallToken } from './localCallToken';
import { ensureFreshLinkToken } from './tokens';

vi.mock('./tokens', () => ({ ensureFreshLinkToken: vi.fn(async (_connector, link) => link) }));

const account = (id: string, accessToken: string, userId = 'u1') => ({
  credentials: {
    accessToken,
    clientSecret: 'never-leaves',
    refreshToken: 'never-leaves',
    type: 'oauth2',
  },
  id,
  name: id,
  status: 'connected',
  userConnectorId: 'c1',
  userId,
});

const oauthConnector = {
  credentials: null,
  id: 'c1',
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://nas.tail1234.ts.net/mcp',
  metadata: { connectVia: 'device' },
  oidcConfig: { clientId: 'client', scheme: 'dcr' },
  userId: 'u1',
};

const call = (
  connector: Record<string, unknown> | undefined,
  {
    links = [account('lnk_a', 'access')],
    linkId,
    userId = 'u1',
  }: { links?: ReturnType<typeof account>[]; linkId?: string; userId?: string } = {},
) => {
  const connectorModel = {
    findById: vi.fn().mockResolvedValue(connector),
    forRow() {
      return this;
    },
    getLinkModel: () => ({ listByConnectorIds: vi.fn().mockResolvedValue(links) }),
  };
  return getConnectorLocalCallToken(
    { connectorModel: connectorModel as never, userId },
    'c1',
    linkId,
  );
};

describe('getConnectorLocalCallToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only a device-routed connector's access token, refreshed first when due", async () => {
    vi.mocked(ensureFreshLinkToken).mockResolvedValueOnce(account('lnk_a', 'refreshed') as never);

    await expect(call(oauthConnector)).resolves.toEqual({
      accessToken: 'refreshed',
      type: 'oauth2',
    });
    expect(ensureFreshLinkToken).toHaveBeenCalledOnce();
  });

  it('returns the token for a localhost / LAN endpoint on automatic routing', async () => {
    await expect(
      call({ ...oauthConnector, mcpServerUrl: 'http://192.168.1.5/mcp', metadata: {} }),
    ).resolves.toEqual({ accessToken: 'access', type: 'oauth2' });
  });

  it('returns the selected account of a connector holding several, its primary one otherwise', async () => {
    const links = [account('lnk_a', 'alice'), account('lnk_b', 'bob')];
    await expect(call(oauthConnector, { links, linkId: 'lnk_b' })).resolves.toEqual({
      accessToken: 'bob',
      type: 'oauth2',
    });
    await expect(call(oauthConnector, { links })).resolves.toEqual({
      accessToken: 'alice',
      type: 'oauth2',
    });
    await expect(call(oauthConnector, { links, linkId: 'lnk_gone' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // The server calls it itself: the token never needs to leave it
  it('returns nothing for a connector the server reaches itself', async () => {
    await expect(call({ ...oauthConnector, metadata: {} })).resolves.toBeNull();
    expect(ensureFreshLinkToken).not.toHaveBeenCalled();
  });

  it('returns nothing for a connector without an OAuth account', async () => {
    await expect(
      call(
        { ...oauthConnector, credentials: { token: 't', type: 'bearer' }, oidcConfig: null },
        { links: [] },
      ),
    ).resolves.toBeNull();
  });

  // A workspace owner may manage the row, but not take another member's token
  it('refuses anyone but the member who connected it', async () => {
    await expect(call(oauthConnector, { userId: 'workspace-owner' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(ensureFreshLinkToken).not.toHaveBeenCalled();
  });

  it('refuses an account another member authorized', async () => {
    await expect(
      call(oauthConnector, { links: [account('lnk_a', 'theirs', 'teammate')] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ensureFreshLinkToken).not.toHaveBeenCalled();
  });

  it('fails when the connector is gone', async () => {
    await expect(call(undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('getResolvedConnectorLocalCallToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads and refreshes a resolved row's accounts through its own scope, without reading it by id", async () => {
    // A private agent's own topic runs its owner's personal connector, which
    // the workspace scope can neither read by id nor list the accounts of.
    const link = account('lnk_a', 'access');
    const personalLinkModel = { listByConnectorIds: vi.fn().mockResolvedValue([link]) };
    const personalModel = {
      forRow() {
        return this;
      },
      getLinkModel: () => personalLinkModel,
    };
    const workspaceLinkModel = { listByConnectorIds: vi.fn().mockResolvedValue([]) };
    const connectorModel = { findById: vi.fn(), forRow: vi.fn(() => personalModel) };
    const personal = { ...oauthConnector, workspaceId: null };

    await expect(
      getResolvedConnectorLocalCallToken(
        {
          connectorLinkModel: workspaceLinkModel as never,
          connectorModel: connectorModel as never,
          userId: 'u1',
        },
        personal as never,
      ),
    ).resolves.toEqual({ accessToken: 'access', type: 'oauth2' });
    expect(connectorModel.findById).not.toHaveBeenCalled();
    expect(connectorModel.forRow).toHaveBeenCalledWith(personal);
    expect(workspaceLinkModel.listByConnectorIds).not.toHaveBeenCalled();
    expect(ensureFreshLinkToken).toHaveBeenCalledWith(personal, link, personalModel);
  });

  it('refuses a resolved row someone else connected', async () => {
    await expect(
      getResolvedConnectorLocalCallToken(
        { connectorModel: {} as never, userId: 'workspace-owner' },
        oauthConnector as never,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
