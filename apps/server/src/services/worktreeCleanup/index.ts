import type {
  ChatTopicMetadata,
  OwnedWorktree,
  OwnedWorktreeCleanup,
  OwnedWorktreeCleanupResult,
  OwnedWorktreeCleanupTrigger,
  OwnedWorktreeRestoreResult,
  OwnedWorktreeTopicRow,
} from '@lobechat/types';
import {
  getTopicWorktreePaths,
  isRetiredTopicStatus,
  OWNED_WORKTREE_HOLD_STATUSES,
  resolveOwnedWorktrees,
  SUBMODULE_COMMITS_REASON,
} from '@lobechat/types';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { deviceGateway as defaultGateway } from '@/server/services/deviceGateway';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { attestedOwnerToken } from './receipt';

const log = debug('lobe-server:worktree-cleanup');

/**
 * Automatic cleanup of the worktrees the app created for a conversation
 * (Better Coding Experience "New worktree"), mirroring how Claude Desktop
 * tidies a session's worktree when it is archived:
 *
 * - archiving a topic (status `completed`) or moving it to the recycle bin
 *   removes its worktree's folder, silently; the branch is always kept;
 * - a worktree with uncommitted work is kept (`keptDirty`) and surfaced in
 *   the topic's Overview, where the user can discard it or keep it for good;
 * - nothing is cleaned while the topic runs or waits on the user, while
 *   another live topic still works in the folder, after the user chose to
 *   keep it, or when git has the worktree locked;
 * - a device that cannot be reached keeps the cleanup `pending` until it
 *   next connects (or the desktop next starts) — no periodic polling;
 * - a topic brought back runs `restore` before its next turn, checking the
 *   branch out again at the same path.
 *
 * The device runs every check that decides whether a folder may go
 * (`cleanupOwnedWorktree` in local-file-shell); this service only decides
 * WHEN, and records what happened in `metadata.ownedWorktrees`.
 */

/** A claim older than this is an executor that died; it is retried. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

type Gateway = Pick<typeof defaultGateway, 'cleanupOwnedWorktree' | 'restoreOwnedWorktree'>;

export interface WorktreeCleanupDeps {
  gateway?: Gateway;
  now?: () => Date;
}

/** One cleanup the desktop runs itself over IPC (no gateway to reach it). */
export interface LocalWorktreeCleanup {
  discard: boolean;
  entry: OwnedWorktree;
  topicId: string;
}

export interface WorktreeCleanupSummary {
  /** `${topicId}:${path}` → state written, for logs and tests. */
  results: Record<string, OwnedWorktreeCleanup['state'] | 'held' | 'skipped'>;
}

const key = (topicId: string, path: string) => `${topicId}:${path}`;

/** The record as handed to an executor: its receipt only if this topic's creator holds it. */
const withAttestedToken = (topicUserId: string, entry: OwnedWorktree): OwnedWorktree => {
  const { ownerNonce: _nonce, ownerToken: _token, ...rest } = entry;
  const ownerToken = attestedOwnerToken(topicUserId, entry);
  return ownerToken ? { ...rest, ownerToken } : rest;
};

const isHeld = (row: OwnedWorktreeTopicRow, previousStatus?: string | null) =>
  [row.status, previousStatus].some(
    (status) => !!status && (OWNED_WORKTREE_HOLD_STATUSES as readonly string[]).includes(status),
  ) || !!row.metadata?.runningOperation;

/** Archived or in the recycle bin — the only topics whose worktrees may go. */
const isRetired = (row: OwnedWorktreeTopicRow) =>
  !!row.isDeleted || isRetiredTopicStatus(row.status);

export class WorktreeCleanupService {
  private readonly topicModel: TopicModel;
  private readonly gateway: Gateway;
  private readonly now: () => Date;

  constructor(
    db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    deps: WorktreeCleanupDeps = {},
  ) {
    this.topicModel = new TopicModel(db, userId, workspaceId);
    this.gateway = deps.gateway ?? defaultGateway;
    this.now = deps.now ?? (() => new Date());
  }

  private stamp(cleanup: Omit<OwnedWorktreeCleanup, 'at'>): OwnedWorktreeCleanup {
    return { ...cleanup, at: this.now().toISOString() };
  }

  private isStaleClaim(cleanup: OwnedWorktreeCleanup | undefined) {
    return (
      cleanup?.state === 'running' &&
      this.now().getTime() - new Date(cleanup.at).getTime() > STALE_CLAIM_MS
    );
  }

  /** States an automatic cleanup may start from. */
  private canAutoStart(cleanup: OwnedWorktreeCleanup | undefined) {
    return !cleanup || cleanup.state === 'pending' || this.isStaleClaim(cleanup);
  }

  /**
   * Compare-and-set the record to `running`, so concurrent executors (the
   * archive hook, a device reconnect, a desktop on startup) never run the
   * same cleanup twice. Returns the claimed record, or undefined.
   */
  private claim(
    topicId: string,
    path: string,
    trigger: OwnedWorktreeCleanupTrigger,
    allowed: (entry: OwnedWorktree, row: OwnedWorktreeTopicRow) => boolean,
  ) {
    return this.topicModel.updateOwnedWorktree(topicId, path, (entry, row) =>
      allowed(entry, row)
        ? { ...entry, cleanup: this.stamp({ state: 'running', trigger }) }
        : undefined,
    );
  }

  /** Write a device's answer to a claimed cleanup. */
  async recordCleanupResult(
    topicId: string,
    path: string,
    trigger: OwnedWorktreeCleanupTrigger,
    result: OwnedWorktreeCleanupResult,
  ): Promise<OwnedWorktree | undefined> {
    return this.topicModel.updateOwnedWorktree(topicId, path, (entry) => {
      // The device reads the branch the worktree is on now: it wins over the
      // one recorded at creation, which a later rename leaves stale.
      const branch = result.branch ?? entry.branch;
      const next = { ...entry, ...(branch && { branch }) };
      switch (result.outcome) {
        case 'removed': {
          return { ...next, cleanup: this.stamp({ state: 'removed', trigger }) };
        }
        case 'dirty': {
          return {
            ...next,
            cleanup: this.stamp({
              dirtyFiles: result.dirtyFiles,
              ...(result.unpushedSubmodules && { reason: SUBMODULE_COMMITS_REASON }),
              state: 'keptDirty',
              trigger,
            }),
          };
        }
        case 'locked': {
          // `git worktree lock` is the user's own "keep": leave it unmanaged.
          const { cleanup: _drop, ...rest } = next;
          return rest;
        }
        case 'unreachable': {
          return {
            ...next,
            cleanup: this.stamp({
              reason: result.outdated ? 'deviceOutdated' : 'deviceOffline',
              state: 'pending',
              trigger,
            }),
          };
        }
        default: {
          return {
            ...next,
            cleanup: this.stamp({ reason: result.error, state: 'failed', trigger }),
          };
        }
      }
    });
  }

  /**
   * Run one claimed cleanup on its device over the gateway. A record without
   * a device (a desktop that never registered with the gateway) waits as
   * `pending` for that desktop to run it.
   */
  private async execute(
    topicId: string,
    entry: OwnedWorktree,
    trigger: OwnedWorktreeCleanupTrigger,
    topicUserId: string,
  ): Promise<OwnedWorktree | undefined> {
    if (!entry.deviceId)
      return this.recordCleanupResult(topicId, entry.path, trigger, {
        error: 'Waiting for the desktop app',
        outcome: 'unreachable',
      });

    const result = await this.gateway.cleanupOwnedWorktree({
      deviceId: entry.deviceId,
      discard: trigger === 'discarded',
      // Presented only when issued to this topic's creator (see `./receipt`).
      ownerToken: attestedOwnerToken(topicUserId, entry),
      sourcePath: entry.sourcePath,
      userId: this.userId,
      workspaceId: this.workspaceId,
      worktreePath: entry.path,
    });
    log('cleanup %s on %s → %o', entry.path, entry.deviceId, result);
    return this.recordCleanupResult(topicId, entry.path, trigger, result);
  }

  /** Whether a run is going on in this folder: this topic's own, or another live topic's. */
  private async inUse(topicId: string, path: string) {
    const [row] = await this.topicModel.findOwnedWorktreeTopics([topicId]);
    return (!!row && isHeld(row)) || this.inUseElsewhere(topicId, path);
  }

  /** Whether another live topic still works in this folder. */
  private async inUseElsewhere(topicId: string, path: string) {
    return (
      (await this.topicModel.countLiveTopicsUsingWorktree({ excludeIds: [topicId], path })) > 0
    );
  }

  /**
   * Try the automatic cleanup of every worktree one retired topic owns.
   * Re-reads the row, so a topic restored meanwhile is left alone.
   */
  private async cleanupTopic(
    row: OwnedWorktreeTopicRow,
    trigger: OwnedWorktreeCleanupTrigger,
    summary: WorktreeCleanupSummary,
    previousStatus?: string | null,
  ) {
    for (const entry of resolveOwnedWorktrees(row.metadata)) {
      const id = key(row.id, entry.path);
      if (!isRetired(row) || isHeld(row, previousStatus)) {
        summary.results[id] = 'held';
        continue;
      }
      if (!this.canAutoStart(entry.cleanup)) {
        summary.results[id] = 'skipped';
        continue;
      }
      if (await this.inUseElsewhere(row.id, entry.path)) {
        summary.results[id] = 'held';
        continue;
      }
      const claimed = await this.claim(
        row.id,
        entry.path,
        trigger,
        (current, fresh) => this.canAutoStart(current.cleanup) && isRetired(fresh),
      );
      if (!claimed) {
        summary.results[id] = 'skipped';
        continue;
      }
      const written = await this.execute(row.id, claimed, trigger, row.userId).catch((error) => {
        log('cleanup of %s failed: %O', entry.path, error);
        return this.recordCleanupResult(row.id, entry.path, trigger, {
          error: (error as Error)?.message,
          outcome: 'error',
        });
      });
      summary.results[id] = written?.cleanup?.state ?? 'skipped';
    }
  }

  /**
   * Topics were archived or moved to the recycle bin: clean up the worktrees
   * they own, and those of already-retired topics that waited only because one
   * of these was still working in their folder. `previousStatus` is the status
   * before an archive overwrote it, so a run that was live is still held.
   */
  async retireTopics(
    topicIds: string[],
    trigger: 'archived' | 'trashed',
    previousStatus: Record<string, string | null | undefined> = {},
  ): Promise<WorktreeCleanupSummary> {
    const summary: WorktreeCleanupSummary = { results: {} };
    const rows = await this.topicModel.findOwnedWorktreeTopics(topicIds);

    for (const row of rows) {
      await this.cleanupTopic(row, trigger, summary, previousStatus[row.id]);
    }

    // A worktree another topic was still using waited (`held`); now that this
    // topic is retired too, its owner may be cleaned up.
    const paths = new Set(rows.flatMap((row) => getTopicWorktreePaths(row.metadata)));
    const seen = new Set(topicIds);
    for (const path of paths) {
      for (const owner of await this.topicModel.findOwnersOfWorktree(path)) {
        if (seen.has(owner.id) || !isRetired(owner)) continue;
        seen.add(owner.id);
        await this.cleanupTopic(owner, owner.isDeleted ? 'trashed' : 'archived', summary);
      }
    }
    return summary;
  }

  /**
   * Take one waiting cleanup for an executor: claim it, or clear it when the
   * topic was restored (or another live topic took the folder) meanwhile —
   * the next archive or trash starts it afresh.
   */
  private async takePending(
    row: OwnedWorktreeTopicRow,
    entry: OwnedWorktree,
  ): Promise<{ claimed: OwnedWorktree; trigger: OwnedWorktreeCleanupTrigger } | undefined> {
    if (entry.cleanup?.state !== 'pending' && !this.isStaleClaim(entry.cleanup)) return;
    const trigger = entry.cleanup?.trigger ?? (row.isDeleted ? 'trashed' : 'archived');
    if (
      trigger !== 'discarded' &&
      (!isRetired(row) || (await this.inUseElsewhere(row.id, entry.path)))
    ) {
      await this.clearCleanup(row.id, entry.path);
      return;
    }
    // A discard waiting on its device still never runs under a live run.
    if (trigger === 'discarded' && (await this.inUse(row.id, entry.path))) return;
    const claimed = await this.claim(
      row.id,
      entry.path,
      trigger,
      (current) => current.cleanup?.state === 'pending' || this.isStaleClaim(current.cleanup),
    );
    return claimed && { claimed, trigger };
  }

  /**
   * A device connected to the gateway: run the cleanups that waited for it.
   */
  async runPendingForDevice(deviceId: string): Promise<WorktreeCleanupSummary> {
    const summary: WorktreeCleanupSummary = { results: {} };
    for (const row of await this.topicModel.findPendingOwnedWorktreeTopics(deviceId)) {
      for (const entry of resolveOwnedWorktrees(row.metadata)) {
        if (entry.deviceId !== deviceId) continue;
        const taken = await this.takePending(row, entry);
        if (!taken) continue;
        const written = await this.execute(row.id, taken.claimed, taken.trigger, row.userId);
        summary.results[key(row.id, entry.path)] = written?.cleanup?.state ?? 'skipped';
      }
    }
    return summary;
  }

  /**
   * The desktop runs over IPC the cleanups that wait on it — its own device
   * id's (gateway off) and those recorded without one (never registered).
   * Claims each before handing it out; the desktop reports every result back
   * with {@link recordCleanupResult}.
   */
  async claimLocalCleanups(
    deviceId: string | undefined,
    {
      canClaim = async () => true,
    }: {
      /** The caller's access to the topic; a job it may not act on is left alone. */
      canClaim?: (row: OwnedWorktreeTopicRow) => Promise<boolean>;
    } = {},
  ): Promise<LocalWorktreeCleanup[]> {
    const claimed: LocalWorktreeCleanup[] = [];
    const rows = [
      ...(deviceId ? await this.topicModel.findPendingOwnedWorktreeTopics(deviceId) : []),
      ...(await this.topicModel.findPendingOwnedWorktreeTopics(undefined)),
    ];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const entry of resolveOwnedWorktrees(row.metadata)) {
        if (entry.deviceId && entry.deviceId !== deviceId) continue;
        const id = key(row.id, entry.path);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!(await canClaim(row))) continue;
        const taken = await this.takePending(row, entry);
        if (taken)
          claimed.push({
            discard: taken.trigger === 'discarded',
            entry: withAttestedToken(row.userId, taken.claimed),
            topicId: row.id,
          });
      }
    }
    return claimed;
  }

  private clearCleanup(topicId: string, path: string) {
    return this.topicModel.updateOwnedWorktree(topicId, path, (entry) => {
      if (!entry.cleanup) return undefined;
      const { cleanup: _drop, ...rest } = entry;
      return rest;
    });
  }

  /**
   * "Discard changes and delete" on a kept worktree. With `local`, only the
   * claim is taken and the desktop runs it over IPC; otherwise it runs on the
   * device now, staying pending if the device cannot be reached.
   */
  async discard(
    topicId: string,
    path: string,
    { local }: { local?: boolean } = {},
  ): Promise<OwnedWorktree | undefined> {
    // Never under a live run: neither this topic's nor another topic's that
    // works in the same folder.
    if (await this.inUse(topicId, path)) return undefined;
    const [row] = await this.topicModel.findOwnedWorktreeTopics([topicId]);
    if (!row) return undefined;
    const claimed = await this.claim(
      topicId,
      path,
      'discarded',
      // Only a worktree the cleanup already set aside (kept, kept dirty,
      // failed) or a discard still waiting on its device: never a live one.
      (entry) =>
        ['failed', 'kept', 'keptDirty'].includes(entry.cleanup?.state ?? '') ||
        (entry.cleanup?.state === 'pending' && entry.cleanup.trigger === 'discarded') ||
        this.isStaleClaim(entry.cleanup),
    );
    if (!claimed) return undefined;
    // The desktop runs it over IPC with the receipt, if this topic's creator holds one.
    if (local) return withAttestedToken(row.userId, claimed);
    return this.execute(topicId, claimed, 'discarded', row.userId);
  }

  /** "Keep": never clean this worktree automatically again. */
  keep(topicId: string, path: string) {
    return this.topicModel.updateOwnedWorktree(topicId, path, (entry) => ({
      ...entry,
      cleanup: this.stamp({ state: 'kept', trigger: entry.cleanup?.trigger }),
    }));
  }

  /**
   * Make a restored topic's worktree usable before its next turn. The record
   * decides, never the folder alone (a running cleanup may not have deleted
   * it yet):
   *
   * - `running`: a cleanup is deleting it now → `busy`; the caller waits.
   * - `pending`: it never ran → cancelled, the folder is still there.
   * - `keptDirty`: the folder is intact → live again, `restored`.
   * - `removed` / `failed`: run the device's `git worktree add <path> <branch>`
   *   (a no-op for a folder still there; the device first waits out a
   *   deletion in flight); with `local`, answer `needsLocal` so the desktop
   *   runs it over IPC and reports its `result`. A branch that is gone sends
   *   the topic back to its source.
   * - otherwise the folder is there → `restored`.
   */
  async restore(
    topicId: string,
    path: string,
    { local, result }: { local?: boolean; result?: OwnedWorktreeRestoreResult } = {},
  ): Promise<OwnedWorktreeRestoreResult> {
    const [row] = await this.topicModel.findOwnedWorktreeTopics([topicId]);
    const entry = resolveOwnedWorktrees(row?.metadata).find((item) => item.path === path);
    if (!row || !entry) return { error: 'Unknown worktree', outcome: 'refused' };

    if (!result) {
      const state = entry.cleanup?.state;
      if (state === 'running' && !this.isStaleClaim(entry.cleanup)) return { outcome: 'busy' };
      if (state === 'pending' || state === 'running') {
        // Cancel only what is still waiting: a claim taken meanwhile wins.
        const cancelled = await this.topicModel.updateOwnedWorktree(topicId, path, (current) => {
          if (current.cleanup?.state !== state) return undefined;
          const { cleanup: _drop, ...rest } = current;
          return rest;
        });
        return cancelled ? { outcome: 'restored' } : { outcome: 'busy' };
      }
      // Kept for its uncommitted work: the folder is intact, and the topic
      // coming back makes it live again (no longer awaiting a choice).
      if (state === 'keptDirty') {
        await this.clearCleanup(topicId, path);
        return { outcome: 'restored' };
      }
      // A failed cleanup may have stopped half-way, or still be deleting after
      // a timeout: ask the device (it waits for a deletion in flight) instead
      // of assuming the folder is there.
      if (state !== 'removed' && state !== 'failed') return { outcome: 'restored' };
    }

    let answer = result;
    if (!answer) {
      // Without a branch nothing can be checked out again; a failed cleanup
      // most likely left the folder, so only a removed one falls back.
      if (!entry.branch)
        answer =
          entry.cleanup?.state === 'failed'
            ? { outcome: 'restored' }
            : { outcome: 'branchMissing' };
      // The desktop holds the receipt in its own copy of the topic; it never
      // travels back in an answer.
      else if (local) return { branch: entry.branch, outcome: 'needsLocal' };
      else if (!entry.deviceId)
        return { error: 'Restore it from the desktop app', outcome: 'unreachable' };
      else
        answer = await this.gateway.restoreOwnedWorktree({
          branch: entry.branch,
          deviceId: entry.deviceId,
          ownerToken: attestedOwnerToken(row.userId, entry),
          sourcePath: entry.sourcePath,
          userId: this.userId,
          workspaceId: this.workspaceId,
          worktreePath: entry.path,
        });
    }

    if (answer.outcome === 'restored') await this.clearCleanup(topicId, path);
    if (answer.outcome === 'branchMissing') await this.fallBackToSource(row, entry);
    return answer;
  }

  /**
   * The branch is gone, so the worktree cannot come back: the topic continues
   * in its source repository. The record stays `removed` and no longer matches
   * the topic's directory, so nothing tries to restore it again.
   */
  private async fallBackToSource(row: OwnedWorktreeTopicRow, entry: OwnedWorktree) {
    const config = row.metadata?.workingDirectoryConfig;
    const patch: Partial<ChatTopicMetadata> = {
      workingDirectory: entry.sourcePath,
      workingDirectoryConfig: {
        ...(config?.environmentId && { environmentId: config.environmentId }),
        path: entry.sourcePath,
        ...(config?.repoType && { repoType: config.repoType }),
      },
    };
    await this.topicModel.updateMetadata(row.id, patch);
    await this.topicModel.updateOwnedWorktree(row.id, entry.path, (current) => ({
      ...current,
      cleanup: this.stamp({
        reason: 'branchMissing',
        state: 'removed',
        trigger: current.cleanup?.trigger,
      }),
    }));
  }
}

/**
 * Run {@link WorktreeCleanupService.retireTopics} after the response: archiving
 * or trashing never waits on a device (a large worktree can take a while).
 * Unscoped, so it never stalls a step's settlement flush.
 */
export const scheduleWorktreeCleanup = (
  params: {
    db: LobeChatDatabase;
    previousStatus?: Record<string, string | null | undefined>;
    topicIds: string[];
    trigger: 'archived' | 'trashed';
    userId: string;
    workspaceId?: string;
  },
  deps?: WorktreeCleanupDeps,
) => {
  const { db, previousStatus, topicIds, trigger, userId, workspaceId } = params;
  if (topicIds.length === 0) return;
  afterUnscoped(async () => {
    const summary = await new WorktreeCleanupService(db, userId, workspaceId, deps).retireTopics(
      topicIds,
      trigger,
      previousStatus,
    );
    if (Object.keys(summary.results).length > 0) log('%s cleanup: %o', trigger, summary.results);
  });
};

const RESTORE_BUSY_WAIT_MS = 120_000;
const RESTORE_BUSY_POLL_MS = 2000;

/**
 * Before the server starts a turn on its own (a delegated task reporting back,
 * a scheduled continuation), bring back the worktree the app created for the
 * topic if a cleanup removed it — the same step the composer runs before a
 * send. Waits while a cleanup is still deleting it. Returns the topic as it
 * now is (a gone branch moves it to its source), or `undefined` when nothing
 * needed doing.
 */
export const restoreOwnedWorktreeBeforeServerRun = async (params: {
  db: LobeChatDatabase;
  metadata: ChatTopicMetadata | null | undefined;
  topicId: string;
  userId: string;
  workspaceId?: string;
}): Promise<{ metadata: ChatTopicMetadata | null | undefined } | undefined> => {
  const { db, metadata, topicId, userId, workspaceId } = params;
  const paths = getTopicWorktreePaths(metadata);
  const entry = resolveOwnedWorktrees(metadata).find((item) => paths.includes(item.path));
  // The server read this metadata just now: a worktree no cleanup has touched
  // (or one the user keeps) is simply there, with nothing to ask anyone.
  if (!entry?.cleanup || entry.cleanup.state === 'kept') return;

  const service = new WorktreeCleanupService(db, userId, workspaceId);
  const deadline = Date.now() + RESTORE_BUSY_WAIT_MS;
  let result = await service.restore(topicId, entry.path);
  while (result.outcome === 'busy' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RESTORE_BUSY_POLL_MS));
    result = await service.restore(topicId, entry.path);
  }
  log('server-run restore of %s → %s', entry.path, result.outcome);
  if (result.outcome !== 'branchMissing') return;
  // The topic now continues in its source repository.
  const [row] = await new TopicModel(db, userId, workspaceId).findOwnedWorktreeTopics([topicId]);
  return { metadata: row?.metadata };
};
