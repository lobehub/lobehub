// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { issueOAuthState } from '@/server/services/messenger/oauth/stateStore';

import { GET } from './route';

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
  getMessengerSlackConfig: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

const { getMessengerSlackConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  appId: 'A_APP',
  clientId: 'cid',
  clientSecret: 'csecret',
  signingSecret: 'sigsec',
};

const buildRequest = (path = '/api/agent/messenger/slack/install'): Request =>
  new Request(`https://app.example.com${path}`);

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'lobe-user-1' } as any,
  });
  vi.mocked(getMessengerSlackConfig).mockResolvedValue(VALID_CONFIG);
  vi.mocked(issueOAuthState).mockResolvedValue('state-nonce-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agent/messenger/slack/install', () => {
  it('redirects unauthenticated users to /signin with callbackUrl', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const res = await GET(buildRequest());
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    const parsed = new URL(location);
    expect(parsed.pathname).toBe('/signin');
    expect(parsed.searchParams.get('callbackUrl')).toBe('/api/agent/messenger/slack/install');
  });

  it('returns 503 when Slack OAuth env is not configured', async () => {
    vi.mocked(getMessengerSlackConfig).mockResolvedValue(null);

    const res = await GET(buildRequest());
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/Slack messenger is not configured/);
  });

  it('issues a state token bound to the LobeHub user and 302s to Slack authorize', async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(302);

    expect(issueOAuthState).toHaveBeenCalledWith({
      lobeUserId: 'lobe-user-1',
      returnTo: undefined,
    });

    const location = res.headers.get('location')!;
    const parsed = new URL(location);
    expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('state')).toBe('state-nonce-1');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/agent/messenger/slack/oauth/callback',
    );
    // Bot scopes from the route's BOT_SCOPES list
    expect(parsed.searchParams.get('scope')).toContain('chat:write');
    expect(parsed.searchParams.get('scope')).toContain('users:read.email');
  });

  it('forwards returnTo into the state payload when provided', async () => {
    await GET(buildRequest('/api/agent/messenger/slack/install?returnTo=/settings/messenger'));
    expect(issueOAuthState).toHaveBeenCalledWith({
      lobeUserId: 'lobe-user-1',
      returnTo: '/settings/messenger',
    });
  });
});
