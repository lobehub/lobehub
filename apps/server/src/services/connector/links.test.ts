import { describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorLinkModel, DecryptedConnectorLink } from '@/database/models/connectorLink';

import {
  ConnectorAccountGoneError,
  loadConnectorLinksMap,
  pickPrimaryLink,
  resolveConnectorAccount,
  resolveLinkedCall,
} from './links';
import { ensureFreshLinkToken } from './tokens';

vi.mock('./tokens', () => ({
  ensureFreshConnectorToken: vi.fn(async (c) => ({ ...c, refreshed: true })),
  ensureFreshLinkToken: vi.fn(async (_c, link) => link),
}));
const connector = {
  id: 'c',
  credentials: null,
  oidcConfig: { clientId: 'client' },
} as DecryptedConnector;
const links = [
  {
    id: 'lnk_a',
    userConnectorId: 'c',
    name: 'alice@example.com',
    status: 'connected',
    credentials: { type: 'oauth2', accessToken: 'alice-token' },
  },
  {
    id: 'lnk_b',
    userConnectorId: 'c',
    name: 'Bob',
    status: 'error',
    credentials: { type: 'oauth2', accessToken: 'bob-token' },
  },
] as DecryptedConnectorLink[];
const context = (rows = links) => ({
  connectorModel: {} as never,
  connectorLinkModel: {
    listByConnectorIds: vi.fn().mockResolvedValue(rows),
  } as unknown as ConnectorLinkModel,
});

describe('resolveLinkedCall', () => {
  it('selects even an unhealthy account explicitly and strips the selector', async () => {
    const result = await resolveLinkedCall(
      { connector, argsStr: '{"link_id":"lnk_b","x":1}' },
      context(),
    );
    expect(result).toMatchObject({
      argsStr: '{"x":1}',
      linkId: 'lnk_b',
      connector: { credentials: { accessToken: 'bob-token' } },
    });
    expect(ensureFreshLinkToken).toHaveBeenLastCalledWith(
      connector,
      links[1],
      expect.anything(),
      expect.anything(),
    );
  });
  it('requires a selector by total count, lists current choices and hides names for visitors', async () => {
    await expect(resolveLinkedCall({ connector }, context())).rejects.toThrow(
      'link_id is required',
    );
    await expect(resolveLinkedCall({ connector, linkId: 'gone' }, context())).rejects.toThrow(
      'no longer exists',
    );
    await expect(resolveLinkedCall({ connector, isShareVisitor: true }, context())).rejects.toThrow(
      'Account 1',
    );
    await expect(
      resolveLinkedCall({ connector, isShareVisitor: true }, context()),
    ).rejects.not.toThrow('alice@example.com');
  });
  it('accepts the sole link without a selector, but validates any supplied one', async () => {
    expect((await resolveLinkedCall({ connector }, context(links.slice(0, 1)))).linkId).toBe(
      'lnk_a',
    );
    await expect(
      resolveLinkedCall({ connector, linkId: 'lnk_b' }, context(links.slice(0, 1))),
    ).rejects.toThrow();
    await expect(resolveLinkedCall({ connector }, context([]))).rejects.toThrow(
      'connect an account',
    );
  });
  it('preserves a business link_id with the collision-safe selector', async () => {
    const result = await resolveLinkedCall(
      {
        connector,
        schemas: [{ properties: { link_id: {} } }],
        argsStr: '{"connector_link_id":"lnk_b","link_id":"business"}',
      },
      context(),
    );
    expect(result.argsStr).toBe('{"link_id":"business"}');
  });
  it('does no storage IO for an empty inventory and picks the earliest healthy primary', async () => {
    expect(await loadConnectorLinksMap([], context())).toEqual(new Map());
    expect(pickPrimaryLink([links[1], links[0]])).toBe(links[0]);
  });
  it('reads accounts only for OAuth connectors, including a legacy OAuth token, never for evaluation mocks', async () => {
    const bearer = {
      id: 'static',
      credentials: { type: 'bearer', token: 't' },
      oidcConfig: null,
    } as DecryptedConnector;
    const none = { id: 'open', credentials: null, oidcConfig: null } as DecryptedConnector;
    const ctx = context();
    expect(await loadConnectorLinksMap([bearer, none], ctx)).toEqual(new Map());
    expect(ctx.connectorLinkModel.listByConnectorIds).not.toHaveBeenCalled();

    const legacy = {
      id: 'legacy',
      credentials: { type: 'oauth2', accessToken: 'old' },
      oidcConfig: null,
    } as DecryptedConnector;
    const evalMock = {
      id: 'eval',
      credentials: { type: 'oauth2', accessToken: 'mock' },
      metadata: { agentEval: {} },
      oidcConfig: { clientId: 'client' },
    } as unknown as DecryptedConnector;
    await loadConnectorLinksMap([bearer, connector, legacy, evalMock], ctx);
    expect(ctx.connectorLinkModel.listByConnectorIds).toHaveBeenCalledWith(['c', 'legacy']);
  });
  it('binds interactive views to an explicit host-provided account', async () => {
    await expect(
      resolveLinkedCall({ connector, fromApp: true, argsStr: '{"link_id":"lnk_b"}' }, context()),
    ).rejects.toThrow('initiating tool call');
    expect(
      (
        await resolveLinkedCall(
          { connector, fromApp: true, linkId: 'lnk_b', argsStr: '{"x":1}' },
          context(),
        )
      ).linkId,
    ).toBe('lnk_b');
  });
});

describe('resolveConnectorAccount', () => {
  it('calls as the primary account, with its refreshed credentials, and says which one', async () => {
    const result = await resolveConnectorAccount(connector, context());
    expect(result).toMatchObject({
      accountCount: 2,
      connector: { credentials: { accessToken: 'alice-token' } },
      linkId: 'lnk_a',
    });
    expect(ensureFreshLinkToken).toHaveBeenCalled();
  });

  it('keeps to a pinned account even when it is not the primary one', async () => {
    const result = await resolveConnectorAccount(connector, context(), 'lnk_b');
    expect(result.connector.credentials).toMatchObject({ accessToken: 'bob-token' });
  });

  it('fails when the pinned account is gone, and uses the row without accounts', async () => {
    await expect(resolveConnectorAccount(connector, context(), 'lnk_x')).rejects.toBeInstanceOf(
      ConnectorAccountGoneError,
    );
    const bearer = { ...connector, oidcConfig: null, credentials: { type: 'bearer' } } as never;
    expect(await resolveConnectorAccount(bearer, context())).toMatchObject({
      accountCount: 0,
      connector: { refreshed: true },
    });
  });
});
