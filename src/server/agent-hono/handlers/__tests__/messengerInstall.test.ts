// @vitest-environment node
import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { issueOAuthState } from '@/server/services/messenger/oauth/stateStore';

import { messengerInstall } from '../messengerInstall';

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/server/services/messenger/oauth/stateStore', () => ({
  issueOAuthState: vi.fn(),
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

const buildContext = (platform: string, path: string): Context => {
  const raw = new Request(`https://app.example.com${path}`);
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
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'lobe-user-1' } as any,
  });
  vi.mocked(getMessengerSlackConfig).mockResolvedValue(VALID_SLACK_CONFIG);
  vi.mocked(getMessengerDiscordConfig).mockResolvedValue(VALID_DISCORD_CONFIG);
  vi.mocked(issueOAuthState).mockResolvedValue('state-nonce-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agent/messenger/:platform/install', () => {
  describe('platform routing', () => {
    it('404s for an unknown platform', async () => {
      const res = await messengerInstall(
        buildContext('unknown', '/api/agent/messenger/unknown/install'),
      );
      expect(res.status).toBe(404);
    });

    it('404s for a known platform that has no OAuth adapter (telegram)', async () => {
      const res = await messengerInstall(
        buildContext('telegram', '/api/agent/messenger/telegram/install'),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('slack', () => {
    it('redirects unauthenticated users to /signin with callbackUrl', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const res = await messengerInstall(
        buildContext('slack', '/api/agent/messenger/slack/install'),
      );
      expect(res.status).toBe(302);
      const parsed = new URL(res.headers.get('location')!);
      expect(parsed.pathname).toBe('/signin');
      expect(parsed.searchParams.get('callbackUrl')).toBe('/api/agent/messenger/slack/install');
    });

    it('returns 503 when Slack OAuth env is not configured', async () => {
      vi.mocked(getMessengerSlackConfig).mockResolvedValue(null);

      const res = await messengerInstall(
        buildContext('slack', '/api/agent/messenger/slack/install'),
      );
      expect(res.status).toBe(503);
      expect(await res.text()).toMatch(/Slack messenger is not configured/);
    });

    it('issues a state token bound to the LobeHub user and 302s to Slack authorize', async () => {
      const res = await messengerInstall(
        buildContext('slack', '/api/agent/messenger/slack/install'),
      );
      expect(res.status).toBe(302);

      expect(issueOAuthState).toHaveBeenCalledWith({
        lobeUserId: 'lobe-user-1',
        returnTo: undefined,
      });

      const parsed = new URL(res.headers.get('location')!);
      expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('cid');
      expect(parsed.searchParams.get('state')).toBe('state-nonce-1');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/api/agent/messenger/slack/oauth/callback',
      );
      expect(parsed.searchParams.get('scope')).toContain('chat:write');
      expect(parsed.searchParams.get('scope')).toContain('users:read.email');
    });

    it('forwards returnTo into the state payload when provided', async () => {
      await messengerInstall(
        buildContext('slack', '/api/agent/messenger/slack/install?returnTo=/settings/messenger'),
      );
      expect(issueOAuthState).toHaveBeenCalledWith({
        lobeUserId: 'lobe-user-1',
        returnTo: '/settings/messenger',
      });
    });
  });

  describe('discord', () => {
    it('returns 503 when Discord client_secret is not configured', async () => {
      vi.mocked(getMessengerDiscordConfig).mockResolvedValue({
        ...VALID_DISCORD_CONFIG,
        clientSecret: undefined,
      });

      const res = await messengerInstall(
        buildContext('discord', '/api/agent/messenger/discord/install'),
      );
      expect(res.status).toBe(503);
      expect(await res.text()).toMatch(/Discord messenger is not configured/);
    });

    it('302s to discord.com authorize with bot scope and permissions', async () => {
      const res = await messengerInstall(
        buildContext('discord', '/api/agent/messenger/discord/install'),
      );
      expect(res.status).toBe(302);
      const parsed = new URL(res.headers.get('location')!);
      expect(parsed.origin + parsed.pathname).toBe('https://discord.com/api/oauth2/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('D_APP');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('state')).toBe('state-nonce-1');
      expect(parsed.searchParams.get('scope')).toContain('bot');
      expect(parsed.searchParams.get('scope')).toContain('applications.commands');
      expect(parsed.searchParams.get('permissions')).toMatch(/^\d+$/);
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/api/agent/messenger/discord/oauth/callback',
      );
    });
  });
});
