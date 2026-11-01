// @vitest-environment node
import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { exchangeCode } from '@/server/services/messenger/oauth/slackOAuth';
import { consumeOAuthState } from '@/server/services/messenger/oauth/stateStore';

import { messengerOAuthCallback } from '../messengerOAuthCallback';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findByTenant: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('@/server/services/messenger/oauth/stateStore', () => ({
  consumeOAuthState: vi.fn(),
}));

vi.mock('@/server/services/messenger/oauth/slackOAuth', () => ({
  exchangeCode: vi.fn(),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(),
  },
}));

vi.mock('@/config/messenger', () => ({
  getMessengerDiscordConfig: vi.fn(),
  getMessengerSlackConfig: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

const { getMessengerSlackConfig, getMessengerDiscordConfig } = await import('@/config/messenger');

const VALID_SLACK_CONFIG = {
  appId: 'A_APP',
  clientId: 'cid',
  clientSecret: 'csecret',
  signingSecret: 'sigsec',
};

const VALID_DISCORD_CONFIG = {
  applicationId: 'D_APP',
  botToken: 'bot-token',
  clientSecret: 'd-secret',
  publicKey: 'pubkey',
};

const buildContext = (platform: string, qs: string): Context => {
  const raw = new Request(
    `https://app.example.com/api/agent/messenger/${platform}/oauth/callback?${qs}`,
  );
  return {
    json: (b: any, status = 200) => Response.json(b, { status }),
    req: {
      param: (name: string) => (name === 'platform' ? platform : undefined),
      raw,
      url: raw.url,
    },
  } as any;
};

beforeEach(() => {
  vi.mocked(getMessengerSlackConfig).mockResolvedValue(VALID_SLACK_CONFIG);
  vi.mocked(getMessengerDiscordConfig).mockResolvedValue(VALID_DISCORD_CONFIG);
  vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue({} as any);
  vi.mocked(consumeOAuthState).mockResolvedValue({ lobeUserId: 'lobe-user-1', ts: Date.now() });
  vi.mocked(exchangeCode).mockResolvedValue({
    access_token: 'xoxb-real',
    app_id: 'A_APP',
    authed_user: { id: 'U_INSTALLER' },
    bot_user_id: 'U_BOT',
    is_enterprise_install: false,
    ok: true,
    scope: 'chat:write,im:history',
    team: { id: 'T_ACME', name: 'Acme Inc' },
  });
  vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agent/messenger/:platform/oauth/callback', () => {
  describe('platform routing', () => {
    it('404s for an unknown platform', async () => {
      const res = await messengerOAuthCallback(buildContext('unknown', 'code=c&state=s'));
      expect(res.status).toBe(404);
    });

    it('404s for telegram (no OAuth adapter)', async () => {
      const res = await messengerOAuthCallback(buildContext('telegram', 'code=c&state=s'));
      expect(res.status).toBe(404);
    });
  });

  describe('slack — error / validation paths', () => {
    it('redirects to settings with error when the upstream returned ?error=', async () => {
      const res = await messengerOAuthCallback(buildContext('slack', 'error=access_denied'));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/settings/messenger/slack');
      expect(loc.searchParams.get('error')).toBe('access_denied');
    });

    it('redirects to settings with missing_code_or_state when params are absent', async () => {
      const res = await messengerOAuthCallback(buildContext('slack', ''));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/settings/messenger/slack');
      expect(loc.searchParams.get('error')).toBe('missing_code_or_state');
    });

    it('returns 503 when Slack messenger env is not configured', async () => {
      vi.mocked(getMessengerSlackConfig).mockResolvedValue(null);
      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));
      expect(res.status).toBe(503);
    });

    it('redirects with invalid_state when the state token has expired or never existed', async () => {
      vi.mocked(consumeOAuthState).mockResolvedValue(null);
      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.searchParams.get('error')).toBe('invalid_state');
    });

    it('redirects with exchange_failed when oauth.v2.access throws', async () => {
      vi.mocked(exchangeCode).mockRejectedValue(new Error('upstream 502'));
      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.searchParams.get('error')).toBe('exchange_failed');
    });

    it('redirects with exchange_failed when neither team.id nor enterprise.id is present', async () => {
      vi.mocked(exchangeCode).mockResolvedValue({
        access_token: 'xoxb-real',
        app_id: 'A_APP',
        is_enterprise_install: false,
        ok: true,
        team: null,
      });
      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      // missing_tenant is mapped to exchange_failed at the route level since
      // the adapter throws — error code surface stays generic per platform.
      expect(loc.searchParams.get('error')).toBe('exchange_failed');
    });
  });

  describe('slack — happy path: workspace install', () => {
    it('persists the installation and redirects to slack.com/app/open', async () => {
      const res = await messengerOAuthCallback(
        buildContext('slack', 'code=the-code&state=the-state'),
      );

      expect(consumeOAuthState).toHaveBeenCalledWith('the-state');
      expect(exchangeCode).toHaveBeenCalledWith({
        clientId: 'cid',
        clientSecret: 'csecret',
        code: 'the-code',
        redirectUri: 'https://app.example.com/api/agent/messenger/slack/oauth/callback',
      });
      expect(MessengerInstallationModel.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          accountId: 'U_BOT',
          applicationId: 'A_APP',
          credentials: { botToken: 'xoxb-real' },
          installedByPlatformUserId: 'U_INSTALLER',
          installedByUserId: 'lobe-user-1',
          metadata: expect.objectContaining({
            isEnterpriseInstall: false,
            scope: 'chat:write,im:history',
            tenantName: 'Acme Inc',
          }),
          platform: 'slack',
          tenantId: 'T_ACME',
        }),
        expect.anything(),
      );

      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe('https://slack.com/app/open');
      expect(loc.searchParams.get('team')).toBe('T_ACME');
      expect(loc.searchParams.get('id')).toBe('A_APP');
    });

    it('stores refreshToken + tokenExpiresAt when token rotation is enabled', async () => {
      vi.mocked(exchangeCode).mockResolvedValue({
        access_token: 'xoxe.xoxb-rot',
        app_id: 'A_APP',
        bot_user_id: 'U_BOT',
        expires_in: 43_200,
        is_enterprise_install: false,
        ok: true,
        refresh_token: 'xoxe-1-r',
        team: { id: 'T_ROT', name: 'Rotating' },
      });

      await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));

      const upsertCall = vi.mocked(MessengerInstallationModel.upsert).mock.calls.at(-1)!;
      const params = upsertCall[1];
      expect(params.credentials).toEqual({
        botToken: 'xoxe.xoxb-rot',
        refreshToken: 'xoxe-1-r',
      });
      expect(params.tokenExpiresAt).toBeInstanceOf(Date);
    });
  });

  describe('slack — takeover guard', () => {
    const existingInstall = {
      applicationId: 'A_APP',
      credentials: {},
      id: 'install-1',
      installedByPlatformUserId: 'U_FIRST_PLATFORM',
      installedByUserId: 'lobe-user-other',
      platform: 'slack',
      revokedAt: null,
      tenantId: 'T_ACME',
    } as any;

    it('refreshes credentials but preserves the original owner, then redirects with already_installed', async () => {
      vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue(existingInstall);

      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));

      expect(MessengerInstallationModel.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          credentials: { botToken: 'xoxb-real' },
          installedByPlatformUserId: 'U_FIRST_PLATFORM',
          installedByUserId: 'lobe-user-other',
          tenantId: 'T_ACME',
        }),
        expect.anything(),
      );

      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/settings/messenger/slack');
      expect(loc.searchParams.get('error')).toBe('already_installed');
      expect(loc.searchParams.get('workspace')).toBe('Acme Inc');
    });

    it('allows takeover when the previous installer was deleted (installedByUserId null)', async () => {
      vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue({
        ...existingInstall,
        installedByUserId: null,
      });

      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));

      expect(MessengerInstallationModel.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ installedByUserId: 'lobe-user-1' }),
        expect.anything(),
      );
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe('https://slack.com/app/open');
    });

    it('allows the same user to re-install (token refresh / scope bump)', async () => {
      vi.mocked(MessengerInstallationModel.findByTenant).mockResolvedValue({
        ...existingInstall,
        installedByUserId: 'lobe-user-1',
      });

      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));

      expect(MessengerInstallationModel.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ installedByUserId: 'lobe-user-1' }),
        expect.anything(),
      );
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe('https://slack.com/app/open');
    });
  });

  describe('slack — Enterprise Grid org install', () => {
    it('keys on enterprise.id and lands on the settings page (no slack.com/app/open)', async () => {
      vi.mocked(exchangeCode).mockResolvedValue({
        access_token: 'xoxb-org',
        app_id: 'A_APP',
        bot_user_id: 'U_BOT',
        enterprise: { id: 'E_BIG', name: 'Big Co' },
        is_enterprise_install: true,
        ok: true,
        team: null,
      });

      const res = await messengerOAuthCallback(buildContext('slack', 'code=c&state=s'));

      const upsertCall = vi.mocked(MessengerInstallationModel.upsert).mock.calls.at(-1)!;
      const params = upsertCall[1];
      expect(params.tenantId).toBe('E_BIG');
      expect(params.metadata).toEqual(
        expect.objectContaining({
          enterpriseId: 'E_BIG',
          isEnterpriseInstall: true,
          tenantName: 'Big Co',
        }),
      );

      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/settings/messenger/slack');
      expect(loc.searchParams.get('installed')).toBe('ok');
    });
  });

  describe('discord — happy path: guild install', () => {
    let originalFetch: typeof globalThis.fetch;
    const fetchMock = vi.fn();

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'd-access',
            application: { id: 'D_APP' },
            expires_in: 604_800,
            guild: { icon: null, id: 'G_GUILD', name: 'My Guild' },
            refresh_token: 'd-refresh',
            scope: 'bot applications.commands',
            token_type: 'Bearer',
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      fetchMock.mockReset();
    });

    it('persists the installation and falls back to settings (no deep link for discord)', async () => {
      const res = await messengerOAuthCallback(
        buildContext('discord', 'code=the-code&state=the-state'),
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://discord.com/api/oauth2/token',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(MessengerInstallationModel.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          applicationId: 'D_APP',
          credentials: { accessToken: 'd-access', refreshToken: 'd-refresh' },
          metadata: expect.objectContaining({ tenantName: 'My Guild' }),
          platform: 'discord',
          tenantId: 'G_GUILD',
        }),
        expect.anything(),
      );

      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/settings/messenger/discord');
      expect(loc.searchParams.get('installed')).toBe('ok');
    });
  });
});
