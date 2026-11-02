import type {
  ScmActorAssociation,
  ScmInstallationRepository,
  ScmInstallationSnapshot,
} from '@lobechat/types';
import debug from 'debug';
import { App, Octokit } from 'octokit';

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

/**
 * Mint an installation token narrowed to ONE repository and ONE permission,
 * for a build that is about to clone it.
 *
 * `app.getInstallationOctokit` would hand back the installation's full grant —
 * every repository it was given, every permission the App declares. A build
 * only ever reads one checkout, so the token it carries is scoped down to
 * exactly that: a request that names `repositories` and `permissions` gets a
 * token that can do nothing else, and it expires within the hour on its own.
 *
 * Narrowing can only ever subtract. Asking for `contents: read` on an App that
 * was not granted it fails here rather than producing a token that fails later
 * inside a sandbox, which is why this returns null instead of throwing: the
 * caller falls back to the other credential path, and the clone still reports
 * its own failure in the build log where someone can read it.
 *
 * Never log the returned token.
 */
export const mintGitHubRepositoryToken = async (params: {
  installationId: string;
  repoFullName: string;
}): Promise<{ expiresAt: string; token: string } | null> => {
  const app = getGitHubApp();
  if (!app) return null;

  try {
    const { data } = await app.octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      {
        installation_id: Number(params.installationId),
        permissions: { contents: 'read' },
        // The short name, not `owner/name`: this endpoint scopes by repository
        // within the installation's own account.
        repositories: [parseRepo(params.repoFullName).repo],
      },
    );

    return { expiresAt: data.expires_at, token: data.token };
  } catch (error) {
    // By shape, never by content — the one path here that holds a credential.
    log('could not mint a clone token for %s: %s', params.repoFullName, (error as Error)?.message);
    return null;
  }
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

/**
 * Cut an Actions job log down to the part that explains the failure. Logs
 * open with hundreds of lines of checkout noise; the first `##[error]`
 * annotation marks where the failing step reported, so the window is
 * centred there (context before, aftermath after) and only falls back to
 * the tail when there is no annotation. Timestamps are stripped: they cost
 * 29 chars per line and tell the agent nothing.
 */
export const trimJobLog = (raw: string, maxChars = 6000): string => {
  const lines = raw.split(/\r?\n/).map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /, ''));
  const errorAt = lines.findIndex((line) => line.includes('##[error]'));
  const window =
    errorAt === -1
      ? lines
      : lines.slice(Math.max(0, errorAt - 60), Math.min(lines.length, errorAt + 20));
  const text = window.join('\n').trim();
  return text.length > maxChars ? text.slice(-maxChars) : text;
};

const parseRepo = (repoFullName: string) => {
  const [owner, repo] = repoFullName.split('/');
  return { owner, repo };
};

/**
 * Tail of a GitHub Actions job log, for the wake-up prompt after a failing
 * check. Actions check runs share their id with the job, so a check's
 * `externalId` of `check_run:<id>` is the job id. Best-effort: a missing log
 * (non-Actions check, expired log) yields `null`, never a thrown error.
 */
export const fetchGitHubJobLogTail = async (params: {
  installationId: string;
  jobId: string;
  maxChars?: number;
  repoFullName: string;
}): Promise<string | null> => {
  const app = getGitHubApp();
  if (!app) return null;

  try {
    const octokit = await app.getInstallationOctokit(Number(params.installationId));
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
      ...parseRepo(params.repoFullName),
      job_id: Number(params.jobId),
    });
    const text = typeof data === 'string' ? data : String(data ?? '');
    if (!text) return null;
    return trimJobLog(text, params.maxChars ?? 6000);
  } catch (error) {
    log('job log %s for %s unavailable: %O', params.jobId, params.repoFullName, error);
    return null;
  }
};

const ASSOCIATIONS = new Set<ScmActorAssociation>([
  'collaborator',
  'contributor',
  'member',
  'none',
  'owner',
]);

const normalizeAssociation = (value: unknown): ScmActorAssociation => {
  const lowered = String(value ?? '').toLowerCase() as ScmActorAssociation;
  return ASSOCIATIONS.has(lowered) ? lowered : 'unknown';
};

export interface GitHubReviewFeedback {
  /** Repository relationship GitHub reported for the author. */
  association: ScmActorAssociation;
  author: string;
  body: string;
  line?: number | null;
  path?: string | null;
  state?: string;
  submittedAt?: string;
  url?: string;
}

/** Reviews per page when walking back from the newest ones. */
const REVIEW_PAGE_SIZE = 100;
/** How far back to walk; a window's worth of reviews never spans more. */
const MAX_REVIEW_PAGES = 3;

/** The `page` of the `rel="last"` entry in a GitHub Link header, if any. */
const lastPageOf = (link: string | undefined): number | null => {
  const match = link?.match(/<([^>]+)>;\s*rel="last"/);
  if (!match) return null;
  const page = Number(new URL(match[1]).searchParams.get('page'));
  return Number.isFinite(page) && page > 1 ? page : null;
};

/**
 * Reviews and inline review comments on a pull request since a given time,
 * for the wake-up prompt after review feedback. One fetch per wake, so the
 * prompt carries everything a reviewer said in the debounce window instead
 * of one event's worth.
 *
 * The reviews endpoint has no `since`, and returns oldest first — so on a
 * long-running pull request the reviews we want are on the *last* page.
 * Reading page one would wake the agent with no feedback at all; walk back
 * from the end until a page starts before the window.
 */
export const fetchGitHubReviewFeedback = async (params: {
  installationId: string;
  number: number;
  repoFullName: string;
  since: Date;
}): Promise<GitHubReviewFeedback[]> => {
  const app = getGitHubApp();
  if (!app) return [];

  try {
    const octokit = await app.getInstallationOctokit(Number(params.installationId));
    const repo = parseRepo(params.repoFullName);
    const sinceMs = params.since.getTime();
    const [reviews, comments] = await Promise.all([
      (async () => {
        const first = await octokit.request(
          'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
          { ...repo, per_page: REVIEW_PAGE_SIZE, pull_number: params.number },
        );
        const last = lastPageOf(first.headers.link as string | undefined);
        if (!last) return first.data;

        const collected: typeof first.data = [];
        for (let page = last; page >= 1 && last - page < MAX_REVIEW_PAGES; page--) {
          const data =
            page === 1
              ? first.data
              : (
                  await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
                    ...repo,
                    page,
                    per_page: REVIEW_PAGE_SIZE,
                    pull_number: params.number,
                  })
                ).data;
          collected.unshift(...data);
          const oldest = data.find((review) => review.submitted_at)?.submitted_at;
          if (oldest && new Date(oldest).getTime() < sinceMs) break;
        }
        return collected;
      })(),
      octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
        ...repo,
        per_page: 100,
        pull_number: params.number,
        since: params.since.toISOString(),
      }),
    ]);

    const feedback: GitHubReviewFeedback[] = [];
    for (const review of reviews) {
      if (!review.body || !review.submitted_at) continue;
      if (new Date(review.submitted_at).getTime() < sinceMs) continue;
      feedback.push({
        association: normalizeAssociation(review.author_association),
        author: review.user?.login ?? 'unknown',
        body: review.body,
        state: review.state,
        submittedAt: review.submitted_at,
        url: review.html_url,
      });
    }
    for (const comment of comments.data) {
      feedback.push({
        association: normalizeAssociation(comment.author_association),
        author: comment.user?.login ?? 'unknown',
        body: comment.body,
        line: comment.line ?? comment.original_line ?? null,
        path: comment.path,
        submittedAt: comment.created_at,
        url: comment.html_url,
      });
    }
    return feedback.sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  } catch (error) {
    log('review feedback for %s#%d unavailable: %O', params.repoFullName, params.number, error);
    return [];
  }
};

/**
 * Post a comment on a pull request (GitHub keeps PR comments on the issues
 * endpoint) and return its id, or `null` when the App cannot write there.
 */
export const postGitHubPullRequestComment = async (params: {
  body: string;
  installationId: string;
  number: number;
  repoFullName: string;
}): Promise<string | null> => {
  const app = getGitHubApp();
  if (!app) return null;

  try {
    const octokit = await app.getInstallationOctokit(Number(params.installationId));
    const { data } = await octokit.request(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      { ...parseRepo(params.repoFullName), body: params.body, issue_number: params.number },
    );
    return String(data.id);
  } catch (error) {
    log('comment on %s#%d failed: %O', params.repoFullName, params.number, error);
    return null;
  }
};

/** Rewrite a comment LobeHub posted earlier. `false` when the App cannot write there any more. */
export const updateGitHubPullRequestComment = async (params: {
  body: string;
  commentId: string;
  installationId: string;
  repoFullName: string;
}): Promise<boolean> => {
  const app = getGitHubApp();
  if (!app) return false;

  try {
    const octokit = await app.getInstallationOctokit(Number(params.installationId));
    await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      ...parseRepo(params.repoFullName),
      body: params.body,
      comment_id: Number(params.commentId),
    });
    return true;
  } catch (error) {
    log('comment %s on %s update failed: %O', params.commentId, params.repoFullName, error);
    return false;
  }
};

/**
 * The installations the *user* can see, read with their own token. This is
 * the only signal that ties a person to an installation: the app-level
 * credential can fetch any installation of this App, so it cannot tell
 * whether the caller is the one who installed it.
 */
export const userCanAccessInstallation = async (
  accessToken: string,
  installationId: string,
): Promise<boolean> => {
  try {
    const octokit = new Octokit({ auth: accessToken });
    for await (const response of octokit.paginate.iterator('GET /user/installations', {
      per_page: 100,
    })) {
      const installations = (response.data ?? []) as { id: number }[];
      if (installations.some((item) => String(item.id) === installationId)) return true;
    }
    return false;
  } catch (error) {
    log('cannot list installations for the authorizing user: %O', error);
    return false;
  }
};
