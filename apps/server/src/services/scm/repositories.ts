import type { ScmRepositoryListItem } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { ScmInstallationModel } from '@/database/models/scm';
import type { LobeChatDatabase } from '@/database/type';
import { scmEnv } from '@/envs/scm';

import { findGitHubInstallationFor } from './cloneCredential';
import {
  listGitHubInstallationRepositoryBranches,
  listGitHubInstallationRepositoryDetails,
} from './github/app';

const log = debug('lobe-server:scm:repositories');

interface ScmScope {
  userId: string;
  workspaceId?: string | null;
}

/** Every installation of the scope failed to answer; nothing was listed. */
export class ScmRepositoriesUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Could not list repositories from GitHub', { cause });
    this.name = 'ScmRepositoriesUnavailableError';
  }
}

const liveGitHubInstallations = async (db: LobeChatDatabase, scope: ScmScope) =>
  (await ScmInstallationModel.listByScope(db, scope)).filter(
    (item) => item.provider === 'github' && !item.suspendedAt,
  );

/**
 * Repositories the scope's live GitHub App installations can read, most
 * recently pushed first. Read through the installations rather than anyone's
 * own token, so the list is exactly what a build from the pick can clone (see
 * `resolveScmCloneCredential`). One installation failing (rate limit, revoked
 * on GitHub before the webhook lands) leaves the others listed; only when
 * every one fails is that an error.
 */
export const listScopeGitHubRepositories = async (
  db: LobeChatDatabase,
  scope: ScmScope,
): Promise<{
  configured: boolean;
  installations: number;
  repositories: ScmRepositoryListItem[];
  truncated: boolean;
}> => {
  if (!scmEnv.ENABLED_GITHUB_APP) {
    return { configured: false, installations: 0, repositories: [], truncated: false };
  }

  const installations = await liveGitHubInstallations(db, scope);
  // Bounded fan-out: one GitHub request per installation, capped so a scope with
  // many installations cannot open an unbounded number of connections at once.
  const outcomes = await pMap(
    installations,
    async (item) => {
      try {
        const value = await listGitHubInstallationRepositoryDetails(item.installationId);
        return { installationId: item.installationId, ok: true as const, value };
      } catch (error) {
        return { error, installationId: item.installationId, ok: false as const };
      }
    },
    { concurrency: 5 },
  );

  const byName = new Map<string, ScmRepositoryListItem>();
  const failures: unknown[] = [];
  let truncated = false;
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome.error);
      console.error(
        '[scm:repositories] installation %s: %s',
        outcome.installationId,
        (outcome.error as Error)?.message,
      );
      continue;
    }
    truncated ||= outcome.value.truncated;
    for (const repo of outcome.value.repositories) byName.set(repo.fullName.toLowerCase(), repo);
  }
  if (installations.length > 0 && failures.length === installations.length) {
    throw new ScmRepositoriesUnavailableError(failures[0]);
  }

  const repositories = [...byName.values()].sort((a, b) =>
    (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''),
  );
  return { configured: true, installations: installations.length, repositories, truncated };
};

/**
 * Branch names of one repository, through the scope's installation that was
 * granted it. `null` when no live installation grants the repository (or the
 * App is not configured): the caller cannot list it, which is not a failure.
 * At `limit` the list may be partial.
 */
export const listScopeGitHubRepositoryBranches = async (
  db: LobeChatDatabase,
  scope: ScmScope,
  params: { limit: number; repoFullName: string },
): Promise<string[] | null> => {
  if (!scmEnv.ENABLED_GITHUB_APP) return null;

  const installation = findGitHubInstallationFor(
    await liveGitHubInstallations(db, scope),
    params.repoFullName,
  );
  if (!installation) {
    log('no installation in scope grants %s', params.repoFullName);
    return null;
  }

  return listGitHubInstallationRepositoryBranches({
    installationId: installation.installationId,
    limit: params.limit,
    repoFullName: params.repoFullName,
  });
};
