import debug from 'debug';

import { ScmIdentityModel } from '@/database/models/scm';
import type { ScmIdentityItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { GitHubRefreshedUserToken } from './app';
import { refreshGitHubUserToken } from './app';
import { describeGitHubError } from './errorLog';

const log = debug('lobe-server:scm:github-user-token');

const REFRESH_MARGIN_MS = 10 * 60 * 1000;

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface GithubUserTokenDeps {
  gateKeeper: () => Promise<GateKeeper>;
  now: () => Date;
  refresh: (refreshToken: string) => Promise<GitHubRefreshedUserToken>;
}

export type GithubUserTokenFailure = 'not_authorized' | 'reauthorize' | 'unavailable';

export type GithubUserTokenResult =
  | {
      expiresAt: Date;
      gitEmail: string;
      gitName: string;
      login: string;
      ok: true;
      token: string;
    }
  | { ok: false; reason: GithubUserTokenFailure };

const defaultDeps: GithubUserTokenDeps = {
  gateKeeper: () => KeyVaultsGateKeeper.initWithEnvKey(),
  now: () => new Date(),
  refresh: refreshGitHubUserToken,
};

const inflight = new Map<string, Promise<GithubUserTokenResult>>();

// Only a refresh GitHub actually refused ends the authorization; a rate limit
// (429, or a secondary-limit 403) must not force everyone to reconnect.
const isRejectedRefresh = (error: unknown) => {
  const status = (error as { status?: unknown })?.status;
  if (status === 400 || status === 401) return true;
  return (
    error instanceof Error && /bad_refresh_token|incorrect_client_credentials/i.test(error.message)
  );
};

export const githubNoreplyEmail = (
  identity: Pick<ScmIdentityItem, 'externalLogin' | 'externalUserId'>,
) => `${identity.externalUserId}+${identity.externalLogin}@users.noreply.github.com`;

const success = (
  identity: Pick<ScmIdentityItem, 'externalLogin' | 'externalUserId' | 'metadata'>,
  token: string,
  expiresAt: Date,
): GithubUserTokenResult => ({
  expiresAt,
  gitEmail: githubNoreplyEmail(identity),
  gitName: identity.metadata.name || identity.externalLogin,
  login: identity.externalLogin,
  ok: true,
  token,
});

export class GithubUserTokenService {
  private readonly deps: GithubUserTokenDeps;

  constructor(
    private readonly db: LobeChatDatabase,
    deps: Partial<GithubUserTokenDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  getFreshToken = (userId: string): Promise<GithubUserTokenResult> =>
    this.dedupe(`fresh:${userId}`, () => this.resolve(userId, false));

  rotate = async (userId: string): Promise<void> => {
    await this.dedupe(`rotate:${userId}`, () => this.resolve(userId, true));
  };

  private dedupe = (key: string, run: () => Promise<GithubUserTokenResult>) => {
    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = run().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };

  private resolve = async (userId: string, force: boolean): Promise<GithubUserTokenResult> => {
    const gateKeeper = await this.deps.gateKeeper();

    return this.db.transaction(async (tx) => {
      const identity = await ScmIdentityModel.lockByUser(tx, 'github', userId, gateKeeper);
      if (!identity?.credentials) {
        return { ok: false, reason: identity ? 'reauthorize' : 'not_authorized' } as const;
      }
      if (!identity.tokenExpiresAt) return { ok: false, reason: 'reauthorize' } as const;

      const stillValid =
        identity.tokenExpiresAt.getTime() - this.deps.now().getTime() > REFRESH_MARGIN_MS;
      if (stillValid && !force) {
        return success(identity, identity.credentials.accessToken, identity.tokenExpiresAt);
      }

      const { refreshToken } = identity.credentials;
      if (!refreshToken) {
        return force
          ? success(identity, identity.credentials.accessToken, identity.tokenExpiresAt)
          : ({ ok: false, reason: 'reauthorize' } as const);
      }

      let refreshed: GitHubRefreshedUserToken;
      try {
        refreshed = await this.deps.refresh(refreshToken);
      } catch (error) {
        if (!isRejectedRefresh(error)) {
          log('refresh for %s failed: %s', userId, describeGitHubError(error));
          return { ok: false, reason: 'unavailable' } as const;
        }
        await ScmIdentityModel.updateCredentials(tx, 'github', userId, null, null, gateKeeper);
        return { ok: false, reason: 'reauthorize' } as const;
      }

      if (!refreshed.expiresAt) return { ok: false, reason: 'reauthorize' } as const;

      const expiresAt = new Date(refreshed.expiresAt);
      await ScmIdentityModel.updateCredentials(
        tx,
        'github',
        userId,
        {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
        },
        expiresAt,
        gateKeeper,
      );
      return success(identity, refreshed.accessToken, expiresAt);
    });
  };
}
