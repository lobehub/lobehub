import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitUpstreamRef } from './types';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT = 5000;

/** Local-only git read. Every step of the resolver degrades to "unknown", never throws. */
const runGit = async (args: string[], cwd: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT });
    return stdout;
  } catch {
    return undefined;
  }
};

interface RemoteRefCandidate extends GitUpstreamRef {
  /** Full refname (`refs/remotes/origin/feat/y`). */
  ref: string;
}

const toUpstreamRef = ({ branch, remote }: RemoteRefCandidate): GitUpstreamRef => ({
  branch,
  remote,
});

/**
 * `refs/remotes/origin/feat/x` → `{ remote: 'origin', branch: 'feat/x' }`.
 *
 * The remote name is matched against the repo's real remote list rather than
 * assumed to be the first path segment, because a remote may itself contain a
 * slash. Longest name first so `origin/fork` wins over `origin` when both exist.
 */
const parseRemoteRef = (ref: string, remotes: string[]): RemoteRefCandidate | undefined => {
  for (const remote of [...remotes].sort((a, b) => b.length - a.length)) {
    const prefix = `refs/remotes/${remote}/`;
    if (!ref.startsWith(prefix)) continue;

    const branch = ref.slice(prefix.length);
    // `refs/remotes/<remote>/HEAD` is the symbolic default-branch pointer, not a branch.
    if (!branch || branch === 'HEAD') return undefined;
    return { branch, ref, remote };
  }
};

const listRemotes = async (dirPath: string): Promise<string[]> => {
  const stdout = await runGit(['remote'], dirPath);
  return (stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

/** The remote's default branch (`origin/canary`), or undefined when `origin/HEAD` is unset. */
const getDefaultRemoteBranch = async (
  dirPath: string,
  remote: string,
): Promise<string | undefined> => {
  const stdout = await runGit(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], dirPath);
  return stdout?.trim() || undefined;
};

interface LocalBranchRef {
  /**
   * `@{upstream}` — the branch's configured PULL source. Emphatically not a push
   * target: `git checkout -b feat/x origin/canary` sets it to `origin/canary`, and
   * it STAYS there after `feat/x` is pushed. Treated as a candidate, never a fact.
   */
  configured?: RemoteRefCandidate;
  /** Commit the local branch points at. */
  sha: string;
}

/**
 * Read a local branch's commit + configured upstream in one shot. Scoped to the
 * NAMED branch rather than HEAD, so a caller holding a topic's persisted branch
 * resolves that branch's ref even when the working directory has moved on.
 */
const readLocalBranchRef = async (
  dirPath: string,
  branch: string,
): Promise<LocalBranchRef | undefined> => {
  const stdout = await runGit(
    [
      'for-each-ref',
      '--format=%(objectname)%09%(upstream:remotename)%09%(upstream)',
      `refs/heads/${branch}`,
    ],
    dirPath,
  );

  const [sha, remote, upstreamRef] = (stdout?.split('\n')[0] ?? '').split('\t');
  if (!sha) return undefined;

  const prefix = `refs/remotes/${remote}/`;
  if (remote && upstreamRef?.startsWith(prefix)) {
    return {
      configured: { branch: upstreamRef.slice(prefix.length), ref: upstreamRef, remote },
      sha,
    };
  }
  return { sha };
};

/**
 * Remote branches whose tip is exactly `sha`. A push updates
 * `refs/remotes/<remote>/<branch>` even without `-u`, so this recovers the remote
 * branch for an explicit-refspec push (`git push origin local:remote`) with zero
 * network and no `gh` dependency.
 */
const listRemoteRefsAt = async (dirPath: string, sha: string): Promise<string[]> => {
  const stdout = await runGit(
    ['for-each-ref', '--points-at', sha, '--format=%(refname)', 'refs/remotes'],
    dirPath,
  );
  return (stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

/**
 * Remote refs some local branch already claims as its upstream. Such a ref belongs
 * to THAT branch — reaching this code means ours has no configured upstream at all.
 */
const listTrackedRemoteRefs = async (dirPath: string): Promise<Set<string>> => {
  const stdout = await runGit(['for-each-ref', '--format=%(upstream)', 'refs/heads'], dirPath);
  return new Set(
    (stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
};

/**
 * Whether THIS repository is what put the commit on that remote ref.
 *
 * Git records the provenance in the remote-tracking ref's reflog: a push writes
 * `update by push`, while a ref that merely arrived by fetch or clone has no reflog
 * at all. That distinction is the whole game here — see {@link inferUpstreamFromSha}.
 */
const wasPushedFromHere = async (dirPath: string, ref: string): Promise<boolean> => {
  const stdout = await runGit(['reflog', 'show', ref], dirPath);
  return !!stdout?.includes('update by push');
};

/**
 * Does remote ref `candidate` hold THIS branch's published work?
 *
 * The question git cannot answer directly, and the crux of this module. Two refs can
 * both look plausible for a branch — the one it forked from and the one it was pushed
 * to — and picking the wrong one binds the topic to another branch's PR. So a
 * candidate has to earn it, one of two ways:
 *
 * 1. It carries the branch's own name. Unambiguous, and covers nearly every branch.
 * 2. Failing that, git must attest that THIS repo put the commit there — a push
 *    writes `update by push` into the remote-tracking ref's reflog, while a ref that
 *    arrived by fetch or clone has no reflog at all. That alone still is not enough:
 *    a ref another local branch already tracks is that branch's, and a remote's
 *    default branch is a fork base, never a feature branch's publication.
 */
const isPublicationOfBranch = (
  candidate: RemoteRefCandidate,
  branch: string,
  ownership: { defaultRefs: Set<string>; pushed: Set<string>; tracked: Set<string> },
): boolean => {
  if (candidate.branch === branch) return true;

  return (
    ownership.pushed.has(candidate.ref) &&
    !ownership.tracked.has(candidate.ref) &&
    !ownership.defaultRefs.has(`${candidate.remote}/${candidate.branch}`)
  );
};

export interface ResolvedUpstream {
  /** Commit the local branch points at — the key for a `gh` commit→PR lookup. */
  sha?: string;
  /** Remote ref the branch publishes to, when one could be established locally. */
  upstream?: GitUpstreamRef;
}

/**
 * Resolve the remote ref a local branch publishes to, from local git state alone.
 *
 * Two sources offer a candidate — the configured `@{upstream}`, and any remote-tracking
 * ref sitting on the branch's commit (a push moves one of those even without `-u`,
 * which is what an explicit refspec always does). NEITHER is trusted on its face:
 *
 * - `@{upstream}` is a PULL source. `git checkout -b feat/x origin/canary` sets it to
 *   `origin/canary` and leaves it there even after `feat/x` is pushed, so taking it at
 *   face value would hunt for a PR whose head is `canary`.
 * - A SHA match is not proof of a push either: a branch with no commits of its own
 *   still sits on the commit it forked from, so the base branch's ref matches too.
 *
 * Both are therefore put through {@link isPublicationOfBranch}, and anything that
 * cannot earn it is dropped. Ambiguity records nothing rather than guess, because the
 * local branch NAME is never a stand-in for a remote ref — it is a device-local label,
 * and passing it off as one is the exact bug this resolver exists to kill. A caller
 * left with nothing still has {@link ResolvedUpstream.sha}, the handle for asking
 * GitHub directly.
 */
export const resolveUpstream = async (
  dirPath: string,
  branch: string,
): Promise<ResolvedUpstream> => {
  const local = await readLocalBranchRef(dirPath, branch);
  if (!local) return {};

  // The overwhelmingly common shape (`git push -u`, same name both ends). Settled
  // without a single extra git call — the ownership probes below are never paid for.
  if (local.configured?.branch === branch) {
    return { sha: local.sha, upstream: toUpstreamRef(local.configured) };
  }

  const remotes = await listRemotes(dirPath);
  if (remotes.length === 0) return { sha: local.sha };

  const atSha = (await listRemoteRefsAt(dirPath, local.sha))
    .map((ref) => parseRemoteRef(ref, remotes))
    .filter((candidate): candidate is RemoteRefCandidate => !!candidate);

  const candidates = [...(local.configured ? [local.configured] : []), ...atSha].filter(
    (candidate, index, all) => all.findIndex((other) => other.ref === candidate.ref) === index,
  );
  if (candidates.length === 0) return { sha: local.sha };

  const [tracked, defaults, pushed] = await Promise.all([
    listTrackedRemoteRefs(dirPath),
    Promise.all(
      [...new Set(candidates.map((candidate) => candidate.remote))].map((remote) =>
        getDefaultRemoteBranch(dirPath, remote),
      ),
    ),
    Promise.all(
      candidates.map(async (candidate) =>
        (await wasPushedFromHere(dirPath, candidate.ref)) ? candidate.ref : undefined,
      ),
    ),
  ]);

  const ownership = {
    defaultRefs: new Set(defaults.filter((ref): ref is string => !!ref)),
    pushed: new Set(pushed.filter((ref): ref is string => !!ref)),
    // A branch's own configured upstream is not "another branch's" — exempt it.
    tracked: new Set([...tracked].filter((ref) => ref !== local.configured?.ref)),
  };

  const owned = candidates.filter((candidate) =>
    isPublicationOfBranch(candidate, branch, ownership),
  );

  return { sha: local.sha, upstream: owned.length === 1 ? toUpstreamRef(owned[0]) : undefined };
};

/**
 * The remote `gh` resolves `{owner}/{repo}` against — `origin` when present, else
 * the first configured remote. Used to name the remote of a ref recovered from
 * GitHub, where only the branch name comes back over the wire.
 */
export const getDefaultRemote = async (dirPath: string): Promise<string | undefined> => {
  const remotes = await listRemotes(dirPath);
  if (remotes.includes('origin')) return 'origin';
  return remotes[0];
};

/** Exit-status-only probe — `runGit` cannot tell success-with-no-output from failure. */
const gitSucceeds = async (args: string[], cwd: string): Promise<boolean> => {
  try {
    await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
};

/**
 * May GitHub be asked which PR carries this commit?
 *
 * Only for a commit that is the branch's OWN work. GitHub's
 * `/commits/{sha}/pulls` answers "which PR introduced this commit", so for a commit
 * already contained in the default branch it hands back the PR that merged it — a
 * stranger's. And a branch carrying no commits of its own still points at the commit
 * it forked from, which is exactly such a commit: asking about it would staple an
 * unrelated merged PR onto a brand-new topic.
 *
 * Answers `false` whenever that cannot be ruled out — including when the default
 * branch is unknown (`refs/remotes/<remote>/HEAD` is only written by `git clone`).
 * The cost of a false negative is the status quo, no PR link; the cost of a false
 * positive is a topic showing someone else's PR.
 */
export const isCommitSafeForPullRequestLookup = async (
  dirPath: string,
  sha: string,
): Promise<boolean> => {
  const remote = await getDefaultRemote(dirPath);
  if (!remote) return false;

  const defaultBranch = await getDefaultRemoteBranch(dirPath, remote);
  if (!defaultBranch) return false;

  return !(await gitSucceeds(
    ['merge-base', '--is-ancestor', sha, `refs/remotes/${defaultBranch}`],
    dirPath,
  ));
};
