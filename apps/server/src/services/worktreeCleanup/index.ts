import type {
  ChatTopicMetadata,
  OwnedWorktree,
  OwnedWorktreeCleanup,
  OwnedWorktreeCleanupResult,
  OwnedWorktreeCleanupTrigger,
  OwnedWorktreeRestoreResult,
} from '@lobechat/types';
import {
  getTopicWorktreePaths,
  isRetiredTopicStatus,
  OWNED_WORKTREE_HOLD_STATUSES,
  resolveOwnedWorktrees,
} from '@lobechat/types';
import debug from 'debug';

import { type OwnedWorktreeTopicRow, TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { deviceGateway as defaultGateway } from '@/server/services/deviceGateway';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

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
      const branch = entry.branch ?? result.branch;
      const next = { ...entry, ...(branch && { branch }) };
      switch (result.outcome) {
        case 'removed': {
          return { ...next, cleanup: this.stamp({ state: 'removed', trigger }) };
        }
        case 'dirty': {
          return {
            ...next,
            cleanup: this.stamp({ dirtyFiles: result.dirtyFiles, state: 'keptDirty', trigger }),
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
  ): Promise<OwnedWorktree | undefined> {
    if (!entry.deviceId)
      return this.recordCleanupResult(topicId, entry.path, trigger, {
        error: 'Waiting for the desktop app',
        outcome: 'unreachable',
      });

    const result = await this.gateway.cleanupOwnedWorktree({
      deviceId: entry.deviceId,
      discard: trigger === 'discarded',
      sourcePath: entry.sourcePath,
      userId: this.userId,
      workspaceId: this.workspaceId,
      worktreePath: entry.path,
    });
    log('cleanup %s on %s → %o', entry.path, entry.deviceId, result);
    return this.recordCleanupResult(topicId, entry.path, trigger, result);
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
      const written = await this.execute(row.id, claimed, trigger).catch((error) => {
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
        const written = await this.execute(row.id, taken.claimed, taken.trigger);
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
  async claimLocalCleanups(deviceId: string | undefined): Promise<LocalWorktreeCleanup[]> {
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
        const taken = await this.takePending(row, entry);
        if (taken)
          claimed.push({
            discard: taken.trigger === 'discarded',
            entry: taken.claimed,
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
    const claimed = await this.claim(
      topicId,
      path,
      'discarded',
      (entry) =>
        !entry.cleanup ||
        ['failed', 'kept', 'keptDirty', 'pending'].includes(entry.cleanup.state) ||
        this.isStaleClaim(entry.cleanup),
    );
    if (!claimed || local) return claimed;
    return this.execute(topicId, claimed, 'discarded');
  }

  /** "Keep": never clean this worktree automatically again. */
  keep(topicId: string, path: string) {
    return this.topicModel.updateOwnedWorktree(topicId, path, (entry) => ({
      ...entry,
      cleanup: this.stamp({ state: 'kept', trigger: entry.cleanup?.trigger }),
    }));
  }

  /**
   * Bring a cleaned-up worktree back for a restored topic: run the device's
   * `git worktree add <path> <branch>` (unless the desktop already did, over
   * IPC, and passes its `result`), then record it. A branch that is gone sends
   * the topic back to its source repository.
   */
  async restore(
    topicId: string,
    path: string,
    result?: OwnedWorktreeRestoreResult,
  ): Promise<OwnedWorktreeRestoreResult> {
    const [row] = await this.topicModel.findOwnedWorktreeTopics([topicId]);
    const entry = resolveOwnedWorktrees(row?.metadata).find((item) => item.path === path);
    if (!row || !entry) return { error: 'Unknown worktree', outcome: 'refused' };
    if (entry.cleanup?.state !== 'removed') return { outcome: 'restored' };

    let answer = result;
    if (!answer) {
      if (!entry.branch) answer = { outcome: 'branchMissing' };
      else if (!entry.deviceId)
        return { error: 'Restore it from the desktop app', outcome: 'unreachable' };
      else
        answer = await this.gateway.restoreOwnedWorktree({
          branch: entry.branch,
          deviceId: entry.deviceId,
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
