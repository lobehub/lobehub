// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as slackOAuth from '../../oauth/slackOAuth';
import { slackOAuthAdapter } from './oauth';

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

beforeEach(() => {
  vi.mocked(getMessengerSlackConfig).mockResolvedValue(VALID_CONFIG as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('slackOAuthAdapter.getAppConfig', () => {
  it('returns clientId/clientSecret from messenger config', async () => {
    expect(await slackOAuthAdapter.getAppConfig()).toEqual({
      clientId: 'cid',
      clientSecret: 'csecret',
    });
  });

  it('returns null when slack is not configured', async () => {
    vi.mocked(getMessengerSlackConfig).mockResolvedValueOnce(null);
    expect(await slackOAuthAdapter.getAppConfig()).toBeNull();
  });
});

describe('slackOAuthAdapter.buildAuthorizeUrl', () => {
  it('delegates to slackOAuth.buildInstallUrl with the messenger bot scopes', () => {
    const url = slackOAuthAdapter.buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://app.example.com/cb',
      state: 'nonce-1',
    });
    const parsed = new URL(url);
    const scope = parsed.searchParams.get('scope') ?? '';
    // Spot-check the messenger scope shape — aligned with the per-agent bot
    // (channels/groups/mpim history, slash commands, assistant) plus the
    // messenger-specific extras (im:write, users:read.email).
    expect(scope.split(',')).toEqual(
      expect.arrayContaining([
        'app_mentions:read',
        'assistant:write',
        'channels:history',
        'channels:read',
        'chat:write',
        'commands',
        'groups:history',
        'groups:read',
        'im:history',
        'im:read',
        'im:write',
        'mpim:history',
        'mpim:read',
        'reactions:read',
        'reactions:write',
        'users:read',
        'users:read.email',
      ]),
    );
    expect(parsed.searchParams.get('state')).toBe('nonce-1');
  });
});

describe('slackOAuthAdapter.exchangeCode', () => {
  it('normalizes a workspace install', async () => {
    vi.spyOn(slackOAuth, 'exchangeCode').mockResolvedValueOnce({
      access_token: 'xoxb-acme',
      app_id: 'A_APP',
      authed_user: { id: 'U_INSTALLER' },
      bot_user_id: 'U_BOT',
      expires_in: 43_200,
      is_enterprise_install: false,
      ok: true,
      refresh_token: 'r-1',
      scope: 'chat:write,im:history',
      team: { id: 'T_ACME', name: 'Acme' },
    } as any);

    const out = await slackOAuthAdapter.exchangeCode({
      clientId: 'cid',
      clientSecret: 'csecret',
      code: 'c',
      redirectUri: 'https://r',
    });

    expect(out.tenantId).toBe('T_ACME');
    expect(out.tenantName).toBe('Acme');
    expect(out.applicationId).toBe('A_APP');
    expect(out.accountId).toBe('U_BOT');
    expect(out.installedByPlatformUserId).toBe('U_INSTALLER');
    expect(out.credentials).toEqual({ botToken: 'xoxb-acme', refreshToken: 'r-1' });
    expect(out.metadata).toEqual({
      enterpriseId: null,
      isEnterpriseInstall: false,
      scope: 'chat:write,im:history',
      tenantName: 'Acme',
    });
    expect(out.tokenExpiresAt).toBeInstanceOf(Date);
  });

  it('uses enterprise.id as tenantId for Enterprise Grid org installs', async () => {
    vi.spyOn(slackOAuth, 'exchangeCode').mockResolvedValueOnce({
      access_token: 'xoxb-org',
      app_id: 'A_APP',
      bot_user_id: 'U_BOT',
      enterprise: { id: 'E_GRID', name: 'GridCorp' },
      is_enterprise_install: true,
      ok: true,
      team: null,
    } as any);

    const out = await slackOAuthAdapter.exchangeCode({
      clientId: 'cid',
      clientSecret: 'csecret',
      code: 'c',
      redirectUri: 'https://r',
    });
    expect(out.tenantId).toBe('E_GRID');
    expect(out.tenantName).toBe('GridCorp');
    expect((out.metadata as any).isEnterpriseInstall).toBe(true);
    expect((out.metadata as any).enterpriseId).toBe('E_GRID');
  });

  it('omits refreshToken when slack does not return one (non-rotating token)', async () => {
    vi.spyOn(slackOAuth, 'exchangeCode').mockResolvedValueOnce({
      access_token: 'xoxb-static',
      app_id: 'A_APP',
      bot_user_id: 'U_BOT',
      is_enterprise_install: false,
      ok: true,
      team: { id: 'T', name: 'T' },
    } as any);

    const out = await slackOAuthAdapter.exchangeCode({
      clientId: 'c',
      clientSecret: 's',
      code: 'c',
      redirectUri: 'r',
    });
    expect((out.credentials as any).refreshToken).toBeUndefined();
    expect(out.tokenExpiresAt).toBeNull();
  });

  it('throws missing_tenant when neither team.id nor enterprise.id is present', async () => {
    vi.spyOn(slackOAuth, 'exchangeCode').mockResolvedValueOnce({
      access_token: 'xoxb-x',
      app_id: 'A_APP',
      is_enterprise_install: false,
      ok: true,
      team: null,
    } as any);

    await expect(
      slackOAuthAdapter.exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'c',
        redirectUri: 'r',
      }),
    ).rejects.toThrow('missing_tenant');
  });

  it('throws missing_token when access_token is absent', async () => {
    vi.spyOn(slackOAuth, 'exchangeCode').mockResolvedValueOnce({
      app_id: 'A_APP',
      is_enterprise_install: false,
      ok: true,
      team: { id: 'T', name: 'T' },
    } as any);

    await expect(
      slackOAuthAdapter.exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'c',
        redirectUri: 'r',
      }),
    ).rejects.toThrow('missing_token');
  });

  it('throws missing_app_id when app_id is absent', async () => {
    vi.spyOn(slackOAuth, 'exchangeCode').mockResolvedValueOnce({
      access_token: 'xoxb',
      is_enterprise_install: false,
      ok: true,
      team: { id: 'T', name: 'T' },
    } as any);

    await expect(
      slackOAuthAdapter.exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'c',
        redirectUri: 'r',
      }),
    ).rejects.toThrow('missing_app_id');
  });
});

describe('slackOAuthAdapter.buildPostInstallRedirect', () => {
  const baseInstall = {
    accountId: 'U_BOT',
    applicationId: 'A_APP',
    credentials: {},
    installedByPlatformUserId: 'U_INSTALLER',
    metadata: { isEnterpriseInstall: false },
    tenantId: 'T_ACME',
    tenantName: 'Acme',
    tokenExpiresAt: null,
  };

  it('builds a slack.com/app/open deep link for workspace installs', () => {
    const url = slackOAuthAdapter.buildPostInstallRedirect!(baseInstall as any, 'origin')!;
    expect(url.origin + url.pathname).toBe('https://slack.com/app/open');
    expect(url.searchParams.get('team')).toBe('T_ACME');
    expect(url.searchParams.get('id')).toBe('A_APP');
  });

  it('returns null for Enterprise Grid org installs (no single team to deep-link)', () => {
    const url = slackOAuthAdapter.buildPostInstallRedirect!(
      { ...baseInstall, metadata: { isEnterpriseInstall: true } } as any,
      'origin',
    );
    expect(url).toBeNull();
  });
});
