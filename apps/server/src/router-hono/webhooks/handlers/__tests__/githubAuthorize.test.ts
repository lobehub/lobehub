// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { githubAuthorize } from '../githubAuthorize';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  issueState: vi.fn(),
  scmEnv: {
    ENABLED_GITHUB_APP: true,
    ENABLED_GITHUB_APP_OAUTH: true,
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
  },
}));

vi.mock('@/envs/scm', () => ({ scmEnv: mocks.scmEnv }));
vi.mock('@/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/server/services/scm/oauth/stateStore', () => ({
  issueScmInstallState: mocks.issueState,
}));

const app = new Hono().get('/authorize', githubAuthorize);
const authorize = (query = '') => app.request(`http://localhost/authorize${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scmEnv.ENABLED_GITHUB_APP_OAUTH = true;
  mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
  mocks.issueState.mockResolvedValue('state-1');
});

describe('githubAuthorize', () => {
  it('sends a signed-in user to GitHub to authorize the App on their behalf', async () => {
    const res = await authorize('?returnTo=%2Fsettings%2Fintegrations%2Fgithub');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: 'Iv1.client',
      redirect_uri: 'http://localhost/api/webhooks/github/oauth/callback',
      state: 'state-1',
    });
    expect(mocks.issueState).toHaveBeenCalledWith({
      lobeUserId: 'user-1',
      purpose: 'authorize',
      returnTo: '/settings/integrations/github',
    });
  });

  it('bounces a signed-out visitor through sign-in and back', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await authorize();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(
      '/signin?callbackUrl=' + encodeURIComponent('/api/webhooks/github/authorize'),
    );
    expect(mocks.issueState).not.toHaveBeenCalled();
  });

  it('explains that the deployment cannot authorize users without OAuth credentials', async () => {
    mocks.scmEnv.ENABLED_GITHUB_APP_OAUTH = false;

    const res = await authorize();

    expect(res.status).toBe(503);
  });
});
