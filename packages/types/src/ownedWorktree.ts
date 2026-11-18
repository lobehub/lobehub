import type { ChatTopicMetadata } from './topic';
import type { WorkingDirConfig } from './workingDir';

/**
 * Worktrees a topic owns: the ones the app created for it (Better Coding
 * Experience "New worktree" on the first send). Recorded on the topic's
 * metadata as `ownedWorktrees` and never rewritten by a later worktree change
 * — unlike `workingDirectoryConfig.git.autoCreated`, which is dropped as soon
 * as the topic moves to another checkout. Retiring the topic (archive or
 * recycle bin) removes the worktree's folder on its device; the branch is
 * always kept, so a restored topic can check it out again at the same path.
 */

/**
 * Where the automatic cleanup of an owned worktree stands. Absent: the topic
 * is live and nothing was tried.
 *
 * - `pending`: the topic was retired but its device could not run the cleanup
 *   yet (offline, or too old for the RPC); the device runs it when it connects.
 * - `running`: a cleanup was claimed and is in flight, so a second executor
 *   (another drain, the desktop on startup) leaves it alone.
 * - `removed`: the folder is gone; the branch is kept.
 * - `keptDirty`: the worktree had uncommitted work, so it was kept.
 * - `kept`: the user chose to keep it; never cleaned automatically again.
 * - `failed`: the device refused or git failed (`reason`), so it was left as is.
 */
export type OwnedWorktreeCleanupState =
  'failed' | 'kept' | 'keptDirty' | 'pending' | 'removed' | 'running';

/** Why a cleanup was started. */
export type OwnedWorktreeCleanupTrigger = 'archived' | 'discarded' | 'trashed';

export interface OwnedWorktreeCleanup {
  /** ISO time of the last state change. */
  at: string;
  /** Tracked changes plus untracked files counted when it was kept dirty. */
  dirtyFiles?: number;
  /** Device/git message behind `failed`, or why a `pending` one waits. */
  reason?: string;
  state: OwnedWorktreeCleanupState;
  trigger?: OwnedWorktreeCleanupTrigger;
}

export interface OwnedWorktree {
  /**
   * The branch the worktree was created on (`lobehub/…`). Absent only on a
   * record backfilled from a topic that had already moved away from it; the
   * device reports it back when the cleanup runs.
   */
  branch?: string;
  cleanup?: OwnedWorktreeCleanup;
  /** ISO time the worktree was created (or the record backfilled). */
  createdAt: string;
  /**
   * The device that holds the folder — its gateway device id, also for this
   * desktop. Absent only for a desktop that never registered with the gateway.
   */
  deviceId?: string;
  /**
   * The nonce the server signed {@link ownerToken} with, over the creator's
   * user id: the server presents the token only for a topic of that creator.
   */
  ownerNonce?: string;
  /**
   * The worktree's creation receipt (`WorkingDirGitState.ownerToken`); the
   * device cleans or restores it only for the matching token. Absent on
   * worktrees created before receipts: those are only ever cleaned
   * automatically (clean ones, branch kept), never discarded.
   */
  ownerToken?: string;
  /** Absolute path of the worktree folder on that device. */
  path: string;
  /** The repository's main checkout the worktree belongs to. */
  sourcePath: string;
}

/** Metadata keys these helpers read; a structural slice of `ChatTopicMetadata`. */
export interface OwnedWorktreeMetadata {
  boundDeviceId?: string;
  ownedWorktrees?: OwnedWorktree[];
  workingDirectoryConfig?: WorkingDirConfig;
}

/** A topic as the worktree cleanup reads it (recycle bin included). */
export interface OwnedWorktreeTopicRow {
  id: string;
  isDeleted: boolean | null;
  metadata: ChatTopicMetadata | null | undefined;
  status: string | null;
  userId: string;
}

/** Topic statuses that mean the run is live or waiting on the user: never clean under them. */
export const OWNED_WORKTREE_HOLD_STATUSES = ['running', 'waitingForHuman'] as const;

/** Topic statuses the UI calls "archived" (`completed`; `archived` is legacy). */
export const RETIRED_TOPIC_STATUSES = ['completed', 'archived'] as const;

export const isRetiredTopicStatus = (status: string | null | undefined): boolean =>
  !!status && (RETIRED_TOPIC_STATUSES as readonly string[]).includes(status);

const samePath = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.replace(/[/\\]+$/, '') === b.replace(/[/\\]+$/, '');

/**
 * Record the worktree the app created for this topic, when the metadata says
 * the topic is on one (`git.autoCreated`). Idempotent: a path already recorded
 * keeps its record, only gaining a device id it lacked. Returns the metadata
 * unchanged (same reference) when there is nothing to add.
 */
export const claimAutoCreatedWorktree = <T extends OwnedWorktreeMetadata>(
  metadata: T,
  now: () => string = () => new Date().toISOString(),
): T => {
  const config = metadata.workingDirectoryConfig;
  const git = config?.git;
  const path = git?.autoCreated ? git.activeWorktree : undefined;
  if (!config || !git || !path) return metadata;

  const owned = metadata.ownedWorktrees ?? [];
  const existing = owned.find((entry) => samePath(entry.path, path));
  if (existing) {
    if (existing.deviceId || !metadata.boundDeviceId) return metadata;
    return {
      ...metadata,
      ownedWorktrees: owned.map((entry) =>
        entry === existing ? { ...entry, deviceId: metadata.boundDeviceId } : entry,
      ),
    };
  }

  const entry: OwnedWorktree = {
    ...(git.branch && { branch: git.branch }),
    createdAt: git.autoCreatedAt ?? now(),
    ...(metadata.boundDeviceId && { deviceId: metadata.boundDeviceId }),
    ...(git.ownerToken && { ownerToken: git.ownerToken }),
    ...(git.ownerNonce && { ownerNonce: git.ownerNonce }),
    path,
    sourcePath: config.path,
  };
  return { ...metadata, ownedWorktrees: [...owned, entry] };
};

/**
 * The worktrees this topic owns, including the ones a topic created before
 * `ownedWorktrees` existed: its marker (`autoCreated` + `activeWorktree`) or,
 * once that marker was dropped by a move, the CLI start folder the app set to
 * the worktree it created (`sessionPath`, only ever written for one). The
 * backfilled records are what the caller persists on its first write.
 */
export const resolveOwnedWorktrees = (
  metadata: OwnedWorktreeMetadata | null | undefined,
  now: () => string = () => new Date().toISOString(),
): OwnedWorktree[] => {
  if (!metadata) return [];
  const claimed = claimAutoCreatedWorktree(metadata, now);
  const owned = [...(claimed.ownedWorktrees ?? [])];
  const config = metadata.workingDirectoryConfig;
  const sessionPath = config?.sessionPath;
  if (
    config &&
    sessionPath &&
    !samePath(sessionPath, config.path) &&
    !owned.some((entry) => samePath(entry.path, sessionPath))
  ) {
    owned.push({
      ...(samePath(config.git?.activeWorktree, sessionPath) &&
        config.git?.branch && { branch: config.git.branch }),
      createdAt: config.git?.autoCreatedAt ?? now(),
      ...(metadata.boundDeviceId && { deviceId: metadata.boundDeviceId }),
      path: sessionPath,
      sourcePath: config.path,
    });
  }
  return owned;
};

export const findOwnedWorktree = (
  metadata: OwnedWorktreeMetadata | null | undefined,
  path: string,
): OwnedWorktree | undefined =>
  resolveOwnedWorktrees(metadata).find((entry) => samePath(entry.path, path));

/** The paths a topic runs in (current worktree and CLI start folder). */
export const getTopicWorktreePaths = (
  metadata: OwnedWorktreeMetadata | null | undefined,
): string[] => {
  const config = metadata?.workingDirectoryConfig;
  return [config?.git?.activeWorktree, config?.sessionPath].filter(
    (path): path is string => !!path,
  );
};

/**
 * What a device reports for one `cleanupOwnedWorktree` call. `removed` covers a
 * folder that was already gone; `refused` is a guard rejection (outside the
 * worktree root, not a linked worktree of the source…), which the caller
 * records as `failed` and never retries.
 */
export type OwnedWorktreeCleanupOutcome =
  | 'dirty'
  | 'error'
  | 'locked'
  | 'refused'
  | 'removed'
  /** Server side only: the device could not be reached (offline, no gateway, too old). */
  | 'unreachable';

export interface OwnedWorktreeCleanupResult {
  /** The branch the worktree was on, so a backfilled record learns it. */
  branch?: string;
  /** Tracked changes + untracked files, for `dirty`. */
  dirtyFiles?: number;
  error?: string;
  outcome: OwnedWorktreeCleanupOutcome;
  /** With `unreachable`: the device answered, but predates the owned-worktree RPCs. */
  outdated?: boolean;
  /** With `dirty`: submodules whose commits no remote holds. */
  unpushedSubmodules?: number;
}

/** `cleanup.reason` of a worktree kept for its submodules' unpushed commits. */
export const SUBMODULE_COMMITS_REASON = 'submoduleCommits';

/** What a device reports for one `restoreOwnedWorktree` call. */
export interface OwnedWorktreeRestoreResult {
  /** With `needsLocal`: the branch to check out, as the server last recorded it. */
  branch?: string;
  error?: string;
  /**
   * `branchMissing`: the branch is gone (deleted after a merge); nothing was
   * created. Server side only: `unreachable` (the device could not be reached),
   * `busy` (a cleanup is deleting the folder right now; ask again shortly) and
   * `needsLocal` (the desktop runs the re-checkout itself over IPC).
   */
  outcome:
    'branchMissing' | 'busy' | 'error' | 'needsLocal' | 'refused' | 'restored' | 'unreachable';
  outdated?: boolean;
}

/** The device client predates the owned-worktree RPCs. */
export const OWNED_WORKTREE_RPC_UNSUPPORTED = 'Unknown device RPC method';
