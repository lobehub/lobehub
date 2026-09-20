import type { ScmInstallationRepository } from '@lobechat/types';
import debug from 'debug';
import { App, Octokit } from 'octokit';

import type { ScmInstallationSnapshot } from '@/database/models/scm';
import { scmEnv } from '@/envs/scm';

const log = debug('lobe-server:scm:github-app');

let cachedApp: App | undefined;

/**
 * The process-wide GitHub App client. `octokit`'s `App` mints the app JWT and
 * caches installation tokens (1h TTL) in memory, so there is no token store
 * to manage here; a fresh process simply mints again.
 */
export const getGitHubApp = (): App | null => {
  if (cachedApp) return cachedApp;
  if (!scmEnv.ENABLED_GITHUB_APP || !scmEnv.GITHUB_APP_ID || !scmEnv.GITHUB_APP_PRIVATE_KEY) {
    return null;
  }

  cachedApp = new App({
    appId: scmEnv.GITHUB_APP_ID,
    oauth:
      scmEnv.GITHUB_APP_CLIENT_ID && scmEnv.GITHUB_APP_CLIENT_SECRET
        ? { clientId: scmEnv.GITHUB_APP_CLIENT_ID, clientSecret: scmEnv.GITHUB_APP_CLIENT_SECRET }
        : undefined,
    privateKey: scmEnv.GITHUB_APP_PRIVATE_KEY,
  });
  return cachedApp;
};

/** Test seam: drop the cached client so a test can rebuild with stubbed env. */
export const resetGitHubApp = () => {
  cachedApp = undefined;
};

/** Where to send a user to install the app. GitHub echoes `state` back on the callback. */
export const buildGitHubInstallUrl = (state: string): string | null => {
  if (!scmEnv.GITHUB_APP_SLUG) return null;
  const url = new URL(`https://github.com/apps/${scmEnv.GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set('state', state);
  return url.toString();
};

export interface GitHubUserAuthorization {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user: { avatarUrl?: string; email?: string | null; externalId: string; login: string };
}

/**
 * Exchange the `code` GitHub appends to the install callback for a
 * user-to-server token, and read who the user is. Requires the App to have
 * "Request user authorization (OAuth) during installation" enabled.
 */
export const exchangeGitHubUserCode = async (code: string): Promise<GitHubUserAuthorization> => {
  const app = getGitHubApp();
  if (!app) throw new Error('GitHub App is not configured');

  const { authentication } = await app.oauth.createToken({ code });
  const octokit = new Octokit({ auth: authentication.token });
  const { data: user } = await octokit.request('GET /user');

  return {
    accessToken: authentication.token,
    expiresAt: 'expiresAt' in authentication ? authentication.expiresAt : undefined,
    refreshToken: 'refreshToken' in authentication ? authentication.refreshToken : undefined,
    refreshTokenExpiresAt:
      'refreshTokenExpiresAt' in authentication ? authentication.refreshTokenExpiresAt : undefined,
    user: {
      avatarUrl: user.avatar_url,
      email: user.email,
      externalId: String(user.id),
      login: user.login,
    },
  };
};

/** Read an installation from the API and shape it like a webhook would. */
export const fetchGitHubInstallation = async (
  installationId: string,
): Promise<ScmInstallationSnapshot> => {
  const app = getGitHubApp();
  if (!app) throw new Error('GitHub App is not configured');

  const { data } = await app.octokit.request('GET /app/installations/{installation_id}', {
    installation_id: Number(installationId),
  });

  const account = data.account as {
    avatar_url?: string;
    id?: number;
    login?: string;
    type?: string;
  } | null;
  const snapshot: ScmInstallationSnapshot = {
    accountExternalId: String(account?.id ?? ''),
    accountLogin: String(account?.login ?? ''),
    accountType: account?.type === 'User' ? 'user' : 'organization',
    installationId: String(data.id),
    metadata: {
      accountAvatarUrl: account?.avatar_url,
      events: data.events,
      permissions: data.permissions as Record<string, string>,
    },
    provider: 'github',
    repositorySelection: data.repository_selection === 'selected' ? 'selected' : 'all',
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
  };

  if (snapshot.repositorySelection === 'selected') {
    snapshot.repositories = await listGitHubInstallationRepositories(installationId);
  }

  return snapshot;
};

export const listGitHubInstallationRepositories = async (
  installationId: string,
): Promise<ScmInstallationRepository[]> => {
  const app = getGitHubApp();
  if (!app) throw new Error('GitHub App is not configured');

  const octokit = await app.getInstallationOctokit(Number(installationId));
  const repositories: ScmInstallationRepository[] = [];
  for await (const { data } of octokit.paginate.iterator('GET /installation/repositories', {
    per_page: 100,
  })) {
    for (const repo of data) {
      repositories.push({
        externalId: String(repo.id),
        fullName: repo.full_name,
        private: repo.private,
      });
    }
  }

  log('installation %s has %d repositories', installationId, repositories.length);
  return repositories;
};
