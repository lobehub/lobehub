import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { DecryptedConnectorLink, OAuthCredentials } from '@/database/models/connectorLink';
import { LEGACY_LINK_ID } from '@/database/models/connectorLink';

import { discoverConnectorAuthorizationServerMetadata, refreshConnectorToken } from './oauth';
import {
  ensureFreshConnectorToken,
  ensureFreshLinkToken,
  refreshExpiredConnectorTokens,
  refreshExpiredLinkTokens,
} from './tokens';

vi.mock('./oauth', () => ({
  discoverConnectorAuthorizationServerMetadata: vi.fn(),
  refreshConnectorToken: vi.fn(),
  toClientInformation: vi.fn(),
}));

const NOW = 1_800_000_000_000;
const expired: OAuthCredentials = {
  accessToken: 'expired',
  expiresAt: NOW - 1000,
  refreshToken: 'previous',
  type: 'oauth2',
};
const rotated = {
  tokens: { access_token: 'fresh', expires_in: 3600, refresh_token: 'next', token_type: 'Bearer' },
};

function store(kind: 'link' | 'legacy' = 'legacy') {
  let row = {
    credentials: kind === 'legacy' ? expired : null,
    id: 'connector',
    isEnabled: true,
    mcpServerUrl: 'https://mcp.example.com/mcp',
    oidcConfig: { clientId: 'client', issuer: 'https://auth.example.com', scheme: 'dcr' },
    status: 'connected',
    workspaceId: null,
  } as DecryptedConnector;
  let link = {
    credentials: expired,
    id: kind === 'legacy' ? LEGACY_LINK_ID : 'lnk_account',
    status: 'connected',
    tokenExpiresAt: new Date(expired.expiresAt!),
  } as DecryptedConnectorLink;
  let queue = Promise.resolve();
  const instance = () => {
    const model = {
      getLinkModel: () => ({
        listByConnectorIds: async () => [
          kind === 'legacy' ? { ...link, credentials: row.credentials, status: row.status } : link,
        ],
        updateCredentials: async (
          _connectorId: string,
          _linkId: string,
          credentials: OAuthCredentials,
          status: DecryptedConnectorLink['status'],
        ) => {
          link = { ...link, credentials, status };
        },
      }),
      update: async (_id: string, { credentials, ...patch }: { credentials?: string }) => {
        row = { ...row, ...patch, ...(credentials && { credentials: JSON.parse(credentials) }) };
        return true;
      },
      withOAuthRefreshLock: vi.fn(
        (_row, action: (current: DecryptedConnector, tx: ConnectorModel) => Promise<unknown>) => {
          const result = queue.then(() => action(row, model as unknown as ConnectorModel));
          queue = result.then(() => {});
          return result;
        },
      ),
    };
    return model as unknown as ConnectorModel;
  };
  return {
    instance,
    read: () => row,
    readLink: () => link,
    reconnect: (credentials: OAuthCredentials) => {
      row = { ...row, credentials };
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.mocked(discoverConnectorAuthorizationServerMetadata).mockResolvedValue({} as never);
  vi.mocked(refreshConnectorToken).mockResolvedValue(rotated);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('OAuth refresh coordination', () => {
  it('makes one request across two instances and both ways of reading a legacy account', async () => {
    const db = store();
    const stale = db.read();
    const outcomes = Promise.all([
      ensureFreshConnectorToken(stale, db.instance()),
      ensureFreshLinkToken(stale, db.readLink(), db.instance()),
    ]);
    await vi.advanceTimersByTimeAsync(500);

    for (const current of await outcomes) {
      expect(current.credentials).toMatchObject({ accessToken: 'fresh', refreshToken: 'next' });
    }
    expect(refreshConnectorToken).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ refreshToken: 'previous' }),
    );
    expect(db.read().credentials).toMatchObject({ refreshState: { status: 'complete' } });
  });

  it.each(['legacy', 'link'] as const)(
    'keeps a %s refresh claimed after the caller stops waiting',
    async (kind) => {
      const db = store(kind);
      const stale = db.read();
      const link = db.readLink();
      const pending = Promise.withResolvers<typeof rotated>();
      const onTimeout = vi.fn();
      vi.mocked(refreshConnectorToken).mockReturnValueOnce(pending.promise);
      const batch = () =>
        kind === 'legacy'
          ? refreshExpiredConnectorTokens([stale], db.instance(), { onTimeout })
          : refreshExpiredLinkTokens(stale, [link], db.instance(), { onTimeout });

      const first = batch();
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await first)[0].credentials).toEqual(expired);

      const second = batch();
      await vi.advanceTimersByTimeAsync(1000);
      expect(refreshConnectorToken).toHaveBeenCalledTimes(1);
      pending.resolve(rotated);
      await vi.advanceTimersByTimeAsync(500);

      expect((await second)[0].credentials).toMatchObject({ accessToken: 'fresh' });
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(refreshConnectorToken).toHaveBeenCalledTimes(1);
    },
  );

  it('reuses a persisted rotation even when the provider omitted expires_in', async () => {
    const db = store();
    const stale = db.read();
    db.reconnect({ accessToken: 'different', refreshToken: 'rotated', type: 'oauth2' });
    expect((await ensureFreshConnectorToken(stale, db.instance())).credentials).toMatchObject({
      accessToken: 'different',
      refreshToken: 'rotated',
    });
    expect(refreshConnectorToken).not.toHaveBeenCalled();
  });

  it.each([
    new OAuthError(OAuthErrorCode.InvalidGrant, 'Grant is no longer valid'),
    new TypeError('Connection lost with unknown refresh outcome'),
    new DOMException('Token response timed out', 'TimeoutError'),
  ])('marks an unusable or uncertain grant as requiring reconnection: %s', async (error) => {
    const db = store('link');
    const stale = db.readLink();
    vi.mocked(refreshConnectorToken).mockRejectedValueOnce(error);
    for (let call = 0; call < 2; call++) {
      expect(await ensureFreshLinkToken(db.read(), stale, db.instance())).toMatchObject({
        credentials: { refreshState: { status: 'reconnect_required' } },
        status: 'error',
      });
    }
    expect(db.read().status).toBe('error');
    expect(db.readLink().credentials.refreshToken).toBeUndefined();
    expect(refreshConnectorToken).toHaveBeenCalledTimes(1);
  });

  it('does not submit a token again when the owner stops before recording the outcome', async () => {
    const db = store();
    db.reconnect({
      ...expired,
      refreshState: { deadline: NOW, id: 'abandoned', status: 'pending' },
    });

    expect(await ensureFreshConnectorToken(db.read(), db.instance())).toMatchObject({
      credentials: { refreshState: { status: 'reconnect_required' } },
      status: 'error',
    });
    expect(refreshConnectorToken).not.toHaveBeenCalled();
  });

  it('preserves credentials when discovery fails and permits a later attempt', async () => {
    const db = store();
    const stale = db.read();
    vi.mocked(discoverConnectorAuthorizationServerMetadata).mockRejectedValueOnce(
      new TypeError('Discovery unavailable'),
    );
    expect((await ensureFreshConnectorToken(stale, db.instance())).credentials).toEqual(expired);
    expect(refreshConnectorToken).not.toHaveBeenCalled();

    expect((await ensureFreshConnectorToken(stale, db.instance())).credentials).toMatchObject({
      accessToken: 'fresh',
    });
  });

  it('keeps a refresh token when the provider does not rotate it', async () => {
    const db = store();
    vi.mocked(refreshConnectorToken).mockResolvedValueOnce({
      tokens: { access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' },
    });

    expect((await ensureFreshConnectorToken(db.read(), db.instance())).credentials).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'previous',
    });
  });

  it('coalesces overlapping calls when an unrotated grant returns identical credentials', async () => {
    const db = store();
    db.reconnect({ ...expired, expiresAt: undefined });
    vi.mocked(refreshConnectorToken).mockResolvedValueOnce({
      tokens: { access_token: expired.accessToken, token_type: 'Bearer' },
    });
    const stale = db.read();
    const outcomes = Promise.all([
      ensureFreshConnectorToken(stale, db.instance()),
      ensureFreshConnectorToken(stale, db.instance()),
    ]);
    await vi.advanceTimersByTimeAsync(500);

    for (const current of await outcomes) {
      expect(current.credentials).toMatchObject({
        accessToken: expired.accessToken,
        refreshState: { status: 'complete' },
        refreshToken: expired.refreshToken,
      });
    }
    expect(refreshConnectorToken).toHaveBeenCalledTimes(1);
  });

  it('keeps a reauthorized grant if an older refresh finishes afterward', async () => {
    const db = store();
    const pending = Promise.withResolvers<typeof rotated>();
    vi.mocked(refreshConnectorToken).mockReturnValueOnce(pending.promise);

    const refresh = ensureFreshConnectorToken(db.read(), db.instance());
    await vi.advanceTimersByTimeAsync(0);
    const authorized: OAuthCredentials = { ...expired, accessToken: 'newly-authorized' };
    db.reconnect(authorized);
    pending.resolve(rotated);

    expect((await refresh).credentials).toEqual(authorized);
    expect(db.read().credentials).toEqual(authorized);
  });

  it('skips disabled, valid and unknown-expiry credentials during run preparation', async () => {
    const db = store();
    const row = db.read();
    const rows = [
      { ...row, isEnabled: false },
      { ...row, credentials: { ...expired, expiresAt: NOW + 3_600_000 } },
      { ...row, credentials: { ...expired, expiresAt: undefined } },
    ];
    const model = db.instance();
    expect(await refreshExpiredConnectorTokens(rows, model)).toEqual(rows);
    expect(model.withOAuthRefreshLock).not.toHaveBeenCalled();
  });
});
