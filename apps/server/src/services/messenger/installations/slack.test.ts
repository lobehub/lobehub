// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { refreshToken } from '@/server/services/messenger/oauth/slackOAuth';

import { SlackInstallationStore } from './slack';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findByTenant: vi.fn(),
    markRevoked: vi.fn(),
    updateRotatedToken: vi.fn(),
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/server/services/messenger/oauth/slackOAuth', () => ({
  refreshToken: vi.fn(),
}));

vi.mock('@/config/messenger', () => ({
  getMessengerSlackConfig: vi.fn(),
}));

const { getMessengerSlackConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  appId: 'A_APP',
  clientId: 'cid',
  clientSecret: 'csecret',
  signingSecret: 'sigsec',
};

const buildRow = (overrides: Partial<any> = {}) => ({
  accessedAt: new Date(),
  accountId: 'U_BOT',
  applicationId: 'A_APP',
  createdAt: new Date(),
  credentials: { botToken: 'xoxb-real', refreshToken: 'r-current' },
  id: 'install-id-1',
  installedByPlatformUserId: null,
  installedByUserId: 'lobe-user-1',
  metadata: { tenantName: 'Acme' },
  platform: 'slack',
  revokedAt: null,
  tenantId: 'T_ACME',
  tokenExpiresAt: null,
  updatedAt: new Date(),
  ...overrides,
});

const eventsApiBody = (teamId: string, isEnterprise = false, enterpriseId?: string) =>
  JSON.stringify({
    api_app_id: 'A_APP',
    authorizations: [
      {
        enterprise_id: enterpriseId ?? null,
        is_enterprise_install: isEnterprise,
        team_id: isEnterprise ? null : teamId,
      },
    ],
    event: { type: 'message', user: 'U_X' },
    type: 'event_callback',
  });

const interactivityBody = (teamId: string) =>
  new URLSearchParams({
    payload: JSON.stringify({
      api_app_id: 'A_APP',
      team: { id: teamId, name: 'Acme' },
      type: 'block_actions',
      user: { id: 'U_X' },
    }),
  }).toString();

const slashCommandBody = (teamId: string) =>
  new URLSearchParams({
    api_app_id: 'A_APP',
    command: '/lobehub',
    team_id: teamId,
    user_id: 'U_X',
  }).toString();

const buildReq = (contentType: string): Request =>
  new Request('https://app.example.com/webhook', {
    headers: { 'content-type': contentType },
    method: 'POST',
  });

beforeEach(() => {
  vi.mocked(getMessengerSlackConfig).mockResolvedValue(VALID_CONFIG);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SlackInstallationStore.resolveByPayload', () => {
  it('routes Events API JSON payloads by authorizations[0].team_id', async () => {
    const acmeRow = buildRow({ id: 'r-acme', tenantId: 'T_ACME' });
    const betaRow = buildRow({ id: 'r-beta', tenantId: 'T_BETA' });
    vi.mocked(MessengerInstallationModel.findByTenant).mockImplementation(
      async (_db, _platform, tenantId) => {
        if (tenantId === 'T_ACME') return acmeRow;
        if (tenantId === 'T_BETA') return betaRow;
        return null;
      },
    );

    const store = new SlackInstallationStore();
    const acme = await store.resolveByPayload(
      buildReq('application/json'),
      eventsApiBody('T_ACME'),
    );
    const beta = await store.resolveByPayload(
      buildReq('application/json'),
      eventsApiBody('T_BETA'),
    );

    expect(acme?.installationKey).toBe('slack:T_ACME');
    expect(beta?.installationKey).toBe('slack:T_BETA');
  });

  it('routes interactivity payloads by team.id', async () => {
    const row = buildRow({ tenantId: 'T_ACME' });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(row);

    const store = new SlackInstallationStore();
    const creds = await store.resolveByPayload(
      buildReq('application/x-www-form-urlencoded'),
      interactivityBody('T_ACME'),
    );

    expect(creds?.tenantId).toBe('T_ACME');
    expect(creds?.botToken).toBe('xoxb-real');
    expect(creds?.signingSecret).toBe('sigsec');
  });

  it('routes slash command form payloads by team_id', async () => {
    const row = buildRow({ tenantId: 'T_ACME' });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(row);

    const store = new SlackInstallationStore();
    const creds = await store.resolveByPayload(
      buildReq('application/x-www-form-urlencoded'),
      slashCommandBody('T_ACME'),
    );

    expect(creds?.tenantId).toBe('T_ACME');
  });

  it('routes Enterprise Grid org-install payloads by enterprise_id', async () => {
    const row = buildRow({ tenantId: 'E_BIG' });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(row);

    const store = new SlackInstallationStore();
    const creds = await store.resolveByPayload(
      buildReq('application/json'),
      eventsApiBody('IGNORED', true, 'E_BIG'),
    );

    expect(creds?.tenantId).toBe('E_BIG');
    expect(MessengerInstallationModel.findByTenant).toHaveBeenCalledWith(
      expect.anything(),
      'slack',
      'E_BIG',
      'A_APP',
      expect.anything(),
    );
  });

  it('returns null for url_verification challenges (no install yet)', async () => {
    const store = new SlackInstallationStore();
    const result = await store.resolveByPayload(
      buildReq('application/json'),
      JSON.stringify({ challenge: 'xyz', token: 't', type: 'url_verification' }),
    );
    expect(result).toBeNull();
    expect(MessengerInstallationModel.findByTenant).not.toHaveBeenCalled();
  });

  it('returns null when env not configured', async () => {
    vi.mocked(getMessengerSlackConfig).mockResolvedValue(null);
    const store = new SlackInstallationStore();
    const result = await store.resolveByPayload(
      buildReq('application/json'),
      eventsApiBody('T_ACME'),
    );
    expect(result).toBeNull();
  });

  it('returns null when no install exists for the resolved tenant', async () => {
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(null);
    const store = new SlackInstallationStore();
    const result = await store.resolveByPayload(
      buildReq('application/json'),
      eventsApiBody('T_UNKNOWN'),
    );
    expect(result).toBeNull();
  });

  it('returns null when malformed JSON / form body', async () => {
    const store = new SlackInstallationStore();
    expect(await store.resolveByPayload(buildReq('application/json'), 'not json')).toBeNull();
  });
});

describe('SlackInstallationStore.resolveByKey', () => {
  it('parses the installation key and looks up the row', async () => {
    const row = buildRow({ tenantId: 'T_ACME' });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(row);

    const store = new SlackInstallationStore();
    const creds = await store.resolveByKey('slack:T_ACME');
    expect(creds?.tenantId).toBe('T_ACME');
    expect(MessengerInstallationModel.findByTenant).toHaveBeenCalledWith(
      expect.anything(),
      'slack',
      'T_ACME',
      'A_APP',
      expect.anything(),
    );
  });

  it("returns null for keys that don't belong to slack", async () => {
    const store = new SlackInstallationStore();
    expect(await store.resolveByKey('telegram:singleton')).toBeNull();
  });
});

describe('SlackInstallationStore token rotation', () => {
  it('refreshes when the token is within REFRESH_BUFFER_MS of expiry', async () => {
    const expiringSoon = buildRow({
      credentials: { botToken: 'xoxe.xoxb-old', refreshToken: 'r-old' },
      tokenExpiresAt: new Date(Date.now() + 30_000), // 30s
    });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(expiringSoon);
    vi.mocked(refreshToken).mockResolvedValue({
      access_token: 'xoxe.xoxb-new',
      expires_in: 43_200,
      ok: true,
      refresh_token: 'r-new',
    });

    const store = new SlackInstallationStore();
    const creds = await store.resolveByKey('slack:T_ACME');

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(MessengerInstallationModel.updateRotatedToken).toHaveBeenCalledWith(
      expect.anything(),
      expiringSoon.id,
      expect.objectContaining({
        credentials: { botToken: 'xoxe.xoxb-new', refreshToken: 'r-new' },
      }),
      expect.anything(),
    );
    expect(creds?.botToken).toBe('xoxe.xoxb-new');
  });

  it('does not refresh when the token has plenty of life left', async () => {
    const fresh = buildRow({
      credentials: { botToken: 'xoxe.xoxb-fresh', refreshToken: 'r-fresh' },
      tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6h
    });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(fresh);

    const store = new SlackInstallationStore();
    const creds = await store.resolveByKey('slack:T_ACME');

    expect(refreshToken).not.toHaveBeenCalled();
    expect(creds?.botToken).toBe('xoxe.xoxb-fresh');
  });

  it('does not refresh when no refresh_token (rotation off)', async () => {
    const noRotation = buildRow({
      credentials: { botToken: 'xoxb-legacy' },
      tokenExpiresAt: new Date(Date.now() + 30_000),
    });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(noRotation);

    const store = new SlackInstallationStore();
    const creds = await store.resolveByKey('slack:T_ACME');

    expect(refreshToken).not.toHaveBeenCalled();
    // Returns the still-valid (about to expire) creds — caller will handle
    // the eventual 401 via Slack's normal error path.
    expect(creds?.botToken).toBe('xoxb-legacy');
  });

  it('single-flights concurrent refreshes per tenant', async () => {
    const expiring = buildRow({
      credentials: { botToken: 'xoxe.xoxb-old', refreshToken: 'r-old' },
      tokenExpiresAt: new Date(Date.now() + 30_000),
    });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(expiring);

    let resolveRefresh: (v: any) => void = () => {};
    vi.mocked(refreshToken).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const store = new SlackInstallationStore();
    const p1 = store.resolveByKey('slack:T_ACME');
    const p2 = store.resolveByKey('slack:T_ACME');
    const p3 = store.resolveByKey('slack:T_ACME');

    // Let all three promises walk through the awaited findByTenant /
    // gateKeeper init and reach the refresh single-flight gate before we
    // assert that only one refresh was triggered.
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshToken).toHaveBeenCalledTimes(1);

    resolveRefresh({
      access_token: 'xoxe.xoxb-new',
      expires_in: 43_200,
      ok: true,
      refresh_token: 'r-new',
    });

    const [c1, c2, c3] = await Promise.all([p1, p2, p3]);
    expect(c1?.botToken).toBe('xoxe.xoxb-new');
    expect(c2?.botToken).toBe('xoxe.xoxb-new');
    expect(c3?.botToken).toBe('xoxe.xoxb-new');
    // Still only one refresh call across all three concurrent lookups.
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original creds if refresh fails', async () => {
    const expiring = buildRow({
      credentials: { botToken: 'xoxe.xoxb-old', refreshToken: 'r-old' },
      tokenExpiresAt: new Date(Date.now() + 30_000),
    });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(expiring);
    vi.mocked(refreshToken).mockRejectedValue(new Error('upstream 502'));

    const store = new SlackInstallationStore();
    const creds = await store.resolveByKey('slack:T_ACME');
    // Refresh failed → return what we still have, so the caller's request can
    // still try (and fail loudly if Slack rejects the stale token).
    expect(creds?.botToken).toBe('xoxe.xoxb-old');
  });
});

describe('SlackInstallationStore.markRevoked', () => {
  it('looks up by tenant and marks the install row revoked', async () => {
    const row = buildRow({ id: 'install-rev', tenantId: 'T_ACME' });
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(row);

    const store = new SlackInstallationStore();
    await store.markRevoked('slack:T_ACME');

    expect(MessengerInstallationModel.markRevoked).toHaveBeenCalledWith(
      expect.anything(),
      'install-rev',
    );
  });

  it('no-ops when the key does not belong to slack', async () => {
    const store = new SlackInstallationStore();
    await store.markRevoked('telegram:singleton');
    expect(MessengerInstallationModel.markRevoked).not.toHaveBeenCalled();
  });

  it('no-ops when there is no install for that tenant', async () => {
    vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(null);
    const store = new SlackInstallationStore();
    await store.markRevoked('slack:T_GONE');
    expect(MessengerInstallationModel.markRevoked).not.toHaveBeenCalled();
  });
});
