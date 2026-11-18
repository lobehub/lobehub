import { z } from 'zod';

/**
 * Working-directory configuration: what a device, an agent default or a topic
 * records about the folder a run works in — source path, repo type and git
 * state (branch, selected worktree, linked PR). Re-exported from `./device`.
 */

/**
 * A working directory source a device has used. Structured (rather than a bare
 * path string) so metadata such as the detected repo type, active git
 * branch, and active git worktree survives — a remote client viewing this
 * device can't re-probe its filesystem, so whatever isn't captured here at the
 * source is lost.
 */
export type WorkingDirRepoType = 'git' | 'github';

export type DeviceGitPullRequestCiStatus = 'failure' | 'pending' | 'success' | 'unknown';

/** A GitHub pull request linked to a branch. */
export interface DeviceGitLinkedPullRequest {
  ciStatus?: DeviceGitPullRequestCiStatus;
  /** The PR's head branch on GitHub. */
  headRefName?: string;
  /**
   * `owner/repo` the PR's head branch lives in — differs from the PR's own
   * repository for a fork PR. Absent from devices that predate it.
   */
  headRepoFullName?: string;
  isDraft?: boolean;
  mergeable?: string;
  mergedAt?: string | null;
  mergeStateStatus?: string;
  number: number;
  reviewDecision?: string;
  state: string;
  title: string;
  url: string;
}

export type DeviceGitLinkedPullRequestLookupStatus = 'error' | 'gh-missing' | 'ok';

export interface WorkingDirGithubState {
  /** Additional PRs targeting the same head branch, beyond the primary one. */
  extraPullRequestCount?: number;
  /** GitHub PR linked to the effective working directory's branch. */
  pullRequest?: DeviceGitLinkedPullRequest | null;
  /** Lookup status for the linked PR probe. */
  pullRequestStatus?: DeviceGitLinkedPullRequestLookupStatus;
}

/**
 * The remote ref a local branch publishes to.
 *
 * Recorded because the local branch name is a DEVICE-LOCAL label: a worktree
 * generates its own (`worktree-feat+foo`), and a push with an explicit refspec
 * (`git push origin local:remote`) renames the branch in flight. Carrying the
 * local name to another machine — or to `gh pr list --head` — yields nothing.
 * The remote ref is the only branch identity that survives leaving this machine,
 * which also makes it the handle for re-fetching the topic's output elsewhere.
 */
export interface DeviceGitUpstreamRef {
  /** Branch name ON the remote (`feat/x`), never the local name. */
  branch: string;
  /** Remote name (`origin`). */
  remote: string;
}

export interface WorkingDirGitState {
  /**
   * Active checkout selected under this git source. When absent, the source
   * path itself is the effective working directory.
   */
  activeWorktree?: string;
  /**
   * True when {@link activeWorktree} was created by the app on the topic's
   * first send (Better Coding Experience "New worktree"), not picked by the
   * user. Such a worktree belongs to this one conversation — the record a
   * later cleanup keys on. Ownership only: where a CLI session starts is
   * {@link WorkingDirConfig.sessionPath}, which outlives a later move.
   */
  autoCreated?: boolean;
  /** ISO time the app created {@link activeWorktree}; set with {@link autoCreated}. */
  autoCreatedAt?: string;
  /**
   * Branch for the effective working directory. Undefined for detached HEAD or
   * when it has not been probed yet.
   */
  branch?: string;
  /** True when the effective working directory is currently detached. */
  detached?: boolean;
  /** GitHub-specific branch metadata such as linked PR and check status. */
  github?: WorkingDirGithubState;
  /**
   * True when the effective working directory is a linked worktree rather than
   * the source path itself.
   */
  isWorktree?: boolean;
  /**
   * A branch this conversation created — the worktree branch made on its first
   * send (Better Coding Experience), or one its agent created
   * (`git switch -c`, `git worktree add -b`). Only while the topic is on it does
   * the run end ask GitHub which PR the branch has: another branch may carry
   * someone else's PR.
   */
  ownBranch?: string;
  /** The nonce the server signed {@link ownerToken} with, for the creator only. */
  ownerNonce?: string;
  /**
   * The creation receipt the device wrote into {@link activeWorktree} when the
   * app created it (set with {@link autoCreated}, only once the device echoed
   * it). A cleanup presents it; the device acts only when it matches, so a
   * client-written claim on someone else's worktree path is worthless.
   */
  ownerToken?: string;
  /**
   * Remote ref {@link branch} publishes to. Dropped alongside {@link github}
   * whenever the branch changes — a stale remote ref would bind the topic to
   * another branch's PR, which is worse than having none.
   */
  upstream?: DeviceGitUpstreamRef;
}

export interface WorkingDirConfig {
  /**
   * The code environment picked with this folder. Metadata only on a device:
   * nothing clones or bootstraps there; the association is kept for later.
   */
  environmentId?: string;
  git?: WorkingDirGitState;
  path: string;
  repoType?: WorkingDirRepoType;
  /**
   * Where local CLI agents start their session, when that is not {@link path}:
   * set once, to the worktree the app created before the topic's first turn.
   * Never moved by a later worktree change — a CLI keys its sessions by cwd,
   * so moving it would drop the conversation's session.
   */
  sessionPath?: string;
}

export type WorkingDirConfigValue = string | WorkingDirConfig;

/**
 * Keep the {@link WorkingDirGitState.autoCreated} marker only while the topic is
 * still on the worktree the app created. Once a writer moves `activeWorktree`
 * (an agent forking another worktree, or leaving it), the marker would point a
 * later cleanup at the wrong checkout. The CLI session cwd is unaffected: it
 * lives in `sessionPath`. Mutates and returns `git`.
 */
export const dropStaleAutoCreated = <T extends WorkingDirGitState>(
  git: T,
  previousWorktree: string | undefined,
): T => {
  if (git.activeWorktree !== previousWorktree) {
    delete git.autoCreated;
    delete git.autoCreatedAt;
    delete git.ownerToken;
    delete git.ownerNonce;
  }
  return git;
};

export const getWorkingDirSourcePath = (
  entry?: WorkingDirConfigValue | null,
): string | undefined => {
  if (!entry) return undefined;
  return typeof entry === 'string' ? entry : entry.path;
};

export const getWorkingDirEffectivePath = (
  entry?: WorkingDirConfigValue | null,
): string | undefined => {
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  return entry.git?.activeWorktree || entry.path;
};

/**
 * Where a local CLI agent (Claude Code, Codex…) starts, which is also the key
 * of its per-cwd session store. Normally the SOURCE repo: a worktree picked
 * mid-conversation must not move the session, so it is only described to the
 * agent. A topic born in a worktree the app created records that worktree as
 * {@link WorkingDirConfig.sessionPath}: the session starts there, keeps
 * starting there whatever worktree the topic moves to later, and the
 * conversation's work stays out of the source checkout.
 */
export const getWorkingDirSessionPath = (
  entry?: WorkingDirConfigValue | null,
): string | undefined => {
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  return entry.sessionPath || entry.path;
};

const gitLinkedPullRequestSchema = z.object({
  ciStatus: z.enum(['failure', 'pending', 'success', 'unknown']).optional(),
  headRefName: z.string().optional(),
  headRepoFullName: z.string().optional(),
  isDraft: z.boolean().optional(),
  mergeable: z.string().optional(),
  mergeStateStatus: z.string().optional(),
  mergedAt: z.string().nullable().optional(),
  number: z.number(),
  reviewDecision: z.string().optional(),
  state: z.string(),
  title: z.string(),
  url: z.string(),
});

export const workingDirConfigSchema = z.object({
  environmentId: z.string().max(255).optional(),
  git: z
    .object({
      activeWorktree: z.string().optional(),
      autoCreated: z.boolean().optional(),
      autoCreatedAt: z.string().optional(),
      branch: z.string().optional(),
      detached: z.boolean().optional(),
      github: z
        .object({
          extraPullRequestCount: z.number().optional(),
          pullRequest: gitLinkedPullRequestSchema.nullable().optional(),
          pullRequestStatus: z.enum(['error', 'gh-missing', 'ok']).optional(),
        })
        .optional(),
      isWorktree: z.boolean().optional(),
      ownBranch: z.string().optional(),
      ownerNonce: z.string().max(64).optional(),
      ownerToken: z.string().max(128).optional(),
      // Mirrors `WorkingDirGitState.upstream`. A field missing here is not merely
      // unvalidated — zod strips it, so it would never survive a write.
      upstream: z
        .object({
          branch: z.string(),
          remote: z.string(),
        })
        .optional(),
    })
    .optional(),
  path: z.string(),
  repoType: z.enum(['git', 'github']).optional(),
  sessionPath: z.string().optional(),
});
