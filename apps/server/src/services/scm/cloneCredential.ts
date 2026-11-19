import debug from 'debug';
import pMap from 'p-map';

import { ScmInstallationModel } from '@/database/models/scm';
import type { ScmInstallationItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { mintGitHubRepositoryToken } from './github/app';

const log = debug('lobe-server:scm:clone-credential');

/** Token mints in flight at once for one specification. */
const CLONE_CREDENTIAL_CONCURRENCY = 3;

/** The only checkout host the sandbox build knows how to authenticate. */
export const GITHUB_HTTPS_PREFIX = 'https://github.com/';

/**
 * One per-host header the build's clone sends, shaped the way the execution
 * plane already accepts it. Deliberately not a url and not part of a source:
 * a credential in either is written into `.git/config` under the build root,
 * which is snapshotted and restored for everyone the environment is published
 * to.
 */
export interface ScmCloneCredential {
  header: string;
  urlPrefix: string;
}

interface SourcedConfiguration {
  sources?: { kind?: string; url?: string }[];
}

/**
 * The GitHub repository a specification builds from, as `owner/name`.
 *
 * Only a github.com https url counts. The runtime refuses anything else at
 * clone time anyway, and a credential must never be attached to a host nobody
 * checked.
 */
export const githubRepositoryOf = (
  configuration: SourcedConfiguration | undefined,
): string | undefined => {
  const url = configuration?.sources?.find(
    (source) => source.kind === 'git' && source.url?.startsWith(GITHUB_HTTPS_PREFIX),
  )?.url;
  if (!url) return undefined;

  const path = url
    .slice(GITHUB_HTTPS_PREFIX.length)
    .replace(/\.git$/, '')
    .replace(/\/$/, '');

  return /^[\w.-]+\/[\w.-]+$/.test(path) ? path : undefined;
};

/**
 * The installation that may read `repository`, among the ones this scope has.
 *
 * `all` selection is matched by account rather than by list: GitHub does not
 * enumerate repositories for an all-repositories installation, so the granted
 * set is "whatever that account owns" and the owner segment is the only thing
 * to compare. A suspended installation is skipped — its tokens are refused,
 * and falling through to the other credential path beats minting one that
 * cannot clone.
 */
export const findGitHubInstallationFor = (
  installations: ScmInstallationItem[],
  repository: string,
): ScmInstallationItem | undefined => {
  const wanted = repository.toLowerCase();
  const owner = wanted.split('/')[0];

  return installations.find((installation) => {
    if (installation.provider !== 'github' || installation.suspendedAt) return false;
    if (installation.repositorySelection === 'all') {
      return installation.accountLogin.toLowerCase() === owner;
    }

    return installation.repositories.some((repo) => repo.fullName.toLowerCase() === wanted);
  });
};

/**
 * A clone credential for this build, from the GitHub App installation that was
 * granted the repository — or `null` when there is no such installation.
 *
 * Preferred over the caller's own OAuth connection wherever it answers, and
 * for one reason: an installation is granted per repository by whoever
 * administers the account, while a user-to-server token carries everything
 * that person can see. The narrower grant is also the more durable one — it
 * survives the person who set it up revoking their own authorization, or
 * leaving.
 *
 * Never throws. A build with no credential still runs: public sources clone,
 * and a private one fails in the build log, naming the repository, which is
 * where someone can act on it. Refusing the build instead would take away the
 * only place that explains itself.
 */
export const resolveScmCloneCredential = async (params: {
  configuration: SourcedConfiguration | undefined;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): Promise<ScmCloneCredential | null> => {
  const repository = githubRepositoryOf(params.configuration);
  if (!repository) return null;

  try {
    const installations = await ScmInstallationModel.listByScope(params.db, {
      userId: params.userId,
      workspaceId: params.workspaceId,
    });
    const installation = findGitHubInstallationFor(installations, repository);
    if (!installation) {
      log('no installation in scope grants %s', repository);
      return null;
    }

    const minted = await mintGitHubRepositoryToken({
      installationId: installation.installationId,
      repoFullName: repository,
    });
    if (!minted) return null;

    return {
      // Basic with the token as the password is what git speaks to GitHub over
      // HTTPS; the username is ignored and conventionally this one.
      header: `Authorization: Basic ${Buffer.from(`x-access-token:${minted.token}`).toString('base64')}`,
      urlPrefix: GITHUB_HTTPS_PREFIX,
    };
  } catch (error) {
    log('could not resolve a clone credential for %s: %s', repository, (error as Error)?.message);
    return null;
  }
};

/** Every GitHub repository a specification checks out, as `{ owner/name, url }`, in order. */
export const githubRepositoriesOf = (
  configuration: SourcedConfiguration | undefined,
): { repository: string; url: string }[] => {
  const seen = new Set<string>();
  return (configuration?.sources ?? []).flatMap((source) => {
    if (source.kind !== 'git' || !source.url) return [];
    const repository = githubRepositoryOf({ sources: [source] });
    if (!repository || seen.has(repository.toLowerCase())) return [];
    seen.add(repository.toLowerCase());
    return [{ repository, url: source.url.replace(/\/$/, '') }];
  });
};

/**
 * One clone credential per GitHub repository the specification checks out.
 *
 * A single repository keeps the host-wide header {@link resolveScmCloneCredential}
 * has always produced. Several are each scoped to their own url: a minted
 * token reads only the repository it was minted for, and git picks the most
 * specific `http.<url>.extraHeader` — a path matches at a `/` boundary, so
 * `…/owner/repo` covers `…/owner/repo/info/refs` and nothing of `…/owner/repo2`.
 *
 * Never throws; a repository without a credential still clones when public.
 */
export const resolveScmCloneCredentials = async (params: {
  configuration: SourcedConfiguration | undefined;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): Promise<ScmCloneCredential[]> => {
  const repositories = githubRepositoriesOf(params.configuration);
  if (repositories.length <= 1) {
    const single = await resolveScmCloneCredential(params);
    return single ? [single] : [];
  }

  // Each one reads the installations and mints a token, so a specification
  // with many repositories is resolved a few at a time.
  const credentials = await pMap(
    repositories,
    async ({ url }) => {
      const credential = await resolveScmCloneCredential({
        ...params,
        configuration: { sources: [{ kind: 'git', url }] },
      });
      return credential ? { ...credential, urlPrefix: url } : undefined;
    },
    { concurrency: CLONE_CREDENTIAL_CONCURRENCY },
  );

  return credentials.filter((credential): credential is ScmCloneCredential => !!credential);
};
