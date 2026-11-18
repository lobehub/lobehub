// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { ChatTopicMetadata, OwnedWorktreeCleanupResult } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topics, users, workspaces } from '@/database/schemas';

import {
  restoreOwnedWorktreeBeforeServerRun,
  STALE_CLAIM_MS,
  WorktreeCleanupService,
} from './index';

vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));

const db = await getTestDB();
const userId = 'worktree-cleanup-user';
const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';
const BRANCH = 'lobehub/quiet-hill';

type Status = 'active' | 'completed' | 'running' | 'waitingForHuman';

const autoCreated = (extra: Partial<ChatTopicMetadata> = {}): ChatTopicMetadata => ({
  boundDeviceId: 'dev-1',
  workingDirectory: WT,
  workingDirectoryConfig: {
    git: { activeWorktree: WT, autoCreated: true, branch: BRANCH, isWorktree: true },
    path: '/code/repo',
    repoType: 'github',
    sessionPath: WT,
  },
  ...extra,
});

const insert = (
  id: string,
  metadata: ChatTopicMetadata,
  extra: { isDeleted?: boolean; status?: Status; userId?: string; workspaceId?: string } = {},
) =>
  db.insert(topics).values({
    deletedAt: extra.isDeleted ? new Date() : null,
    id,
    isDeleted: extra.isDeleted ?? null,
    metadata,
    status: extra.status ?? 'completed',
    userId: extra.userId ?? userId,
    workspaceId: extra.workspaceId ?? null,
  });

const entryOf = async (id: string) =>
  (await db.select().from(topics).where(eq(topics.id, id)))[0]?.metadata?.ownedWorktrees?.[0];

let gateway: {
  cleanupOwnedWorktree: ReturnType<typeof vi.fn>;
  restoreOwnedWorktree: ReturnType<typeof vi.fn>;
};
let now: Date;
const service = () =>
  new WorktreeCleanupService(db, userId, undefined, { gateway: gateway as any, now: () => now });

const answers = (result: OwnedWorktreeCleanupResult) =>
  gateway.cleanupOwnedWorktree.mockResolvedValue(result);

beforeEach(async () => {
  now = new Date('2026-11-17T00:00:00.000Z');
  gateway = { cleanupOwnedWorktree: vi.fn(), restoreOwnedWorktree: vi.fn() };
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(topics).where(eq(topics.userId, userId));
  await db.delete(users).where(inArray(users.id, [userId]));
});

describe('retireTopics — cleaning up', () => {
  it('removes a clean worktree of an archived topic on its device and records it', async () => {
    await insert('t1', autoCreated());
    answers({ branch: BRANCH, outcome: 'removed' });

    const summary = await service().retireTopics(['t1'], 'archived', { t1: 'active' });

    expect(gateway.cleanupOwnedWorktree).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      discard: false,
      sourcePath: '/code/repo',
      userId,
      workspaceId: undefined,
      worktreePath: WT,
    });
    expect(summary.results).toEqual({ [`t1:${WT}`]: 'removed' });
    expect(await entryOf('t1')).toMatchObject({
      branch: BRANCH,
      cleanup: { state: 'removed', trigger: 'archived' },
      path: WT,
    });
  });

  it('cleans up a trashed topic too', async () => {
    await insert('t-trash', autoCreated(), { isDeleted: true, status: 'active' });
    answers({ outcome: 'removed' });
    await service().retireTopics(['t-trash'], 'trashed');
    expect((await entryOf('t-trash'))?.cleanup).toMatchObject({
      state: 'removed',
      trigger: 'trashed',
    });
  });

  it('keeps a dirty worktree and records the file count', async () => {
    await insert('t-dirty', autoCreated());
    answers({ branch: BRANCH, dirtyFiles: 3, outcome: 'dirty' });
    await service().retireTopics(['t-dirty'], 'archived');
    expect((await entryOf('t-dirty'))?.cleanup).toMatchObject({
      dirtyFiles: 3,
      state: 'keptDirty',
    });
  });

  it("records a worktree kept for its submodules' unpushed commits", async () => {
    await insert('t-sub', autoCreated());
    answers({ branch: BRANCH, dirtyFiles: 0, outcome: 'dirty', unpushedSubmodules: 1 });
    await service().retireTopics(['t-sub'], 'archived');
    expect((await entryOf('t-sub'))?.cleanup).toMatchObject({
      reason: 'submoduleCommits',
      state: 'keptDirty',
    });
  });

  it('leaves a locked worktree unmanaged', async () => {
    await insert('t-lock', autoCreated());
    answers({ outcome: 'locked' });
    await service().retireTopics(['t-lock'], 'archived');
    expect((await entryOf('t-lock'))?.cleanup).toBeUndefined();
  });

  it('records a refused guard as failed and never retries it automatically', async () => {
    await insert('t-refused', autoCreated());
    answers({ error: 'Not a worktree of the source repository', outcome: 'refused' });
    await service().retireTopics(['t-refused'], 'archived');
    expect((await entryOf('t-refused'))?.cleanup).toMatchObject({ state: 'failed' });

    gateway.cleanupOwnedWorktree.mockClear();
    await service().retireTopics(['t-refused'], 'archived');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('does nothing for topics without an owned worktree', async () => {
    await insert('t-plain', { workingDirectoryConfig: { path: '/code/repo' } });
    expect((await service().retireTopics(['t-plain'], 'archived')).results).toEqual({});
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });
});

describe('retireTopics — not cleaning up', () => {
  it.each<[string, Status, Status | undefined]>([
    ['running when archived', 'completed', 'running'],
    ['waiting on the user when archived', 'completed', 'waitingForHuman'],
  ])('holds a topic that was %s', async (_, status, previous) => {
    await insert('t-held', autoCreated(), { status });
    const summary = await service().retireTopics(['t-held'], 'archived', { 't-held': previous });
    expect(summary.results[`t-held:${WT}`]).toBe('held');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('holds a trashed topic whose run is still live', async () => {
    await insert('t-run', autoCreated({ runningOperation: { operationId: 'op' } as any }), {
      isDeleted: true,
      status: 'running',
    });
    await service().retireTopics(['t-run'], 'trashed');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('holds a topic restored before the cleanup ran', async () => {
    await insert('t-back', autoCreated(), { status: 'active' });
    await service().retireTopics(['t-back'], 'archived');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('skips a worktree the user chose to keep', async () => {
    await insert(
      't-kept',
      autoCreated({
        ownedWorktrees: [
          {
            branch: BRANCH,
            cleanup: { at: 'x', state: 'kept' },
            createdAt: 'y',
            deviceId: 'dev-1',
            path: WT,
            sourcePath: '/code/repo',
          },
        ],
      }),
    );
    await service().retireTopics(['t-kept'], 'archived');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('holds a worktree another live topic still works in, and cleans it once that one retires', async () => {
    await insert('owner', autoCreated());
    // A handoff that continues in the owner's worktree.
    await insert(
      'follower',
      { workingDirectoryConfig: { git: { activeWorktree: WT }, path: '/code/repo' } },
      { status: 'active' },
    );
    answers({ outcome: 'removed' });

    expect((await service().retireTopics(['owner'], 'archived')).results).toEqual({
      [`owner:${WT}`]: 'held',
    });
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();

    await db.update(topics).set({ status: 'completed' }).where(eq(topics.id, 'follower'));
    expect((await service().retireTopics(['follower'], 'archived')).results).toEqual({
      [`owner:${WT}`]: 'removed',
    });
  });
});

describe('offline devices', () => {
  it('marks the cleanup pending when the device is offline, and runs it when it connects', async () => {
    await insert('t-off', autoCreated());
    answers({ error: 'Device is offline', outcome: 'unreachable' });
    await service().retireTopics(['t-off'], 'archived');
    expect((await entryOf('t-off'))?.cleanup).toMatchObject({
      reason: 'deviceOffline',
      state: 'pending',
      trigger: 'archived',
    });

    answers({ outcome: 'removed' });
    const summary = await service().runPendingForDevice('dev-1');
    expect(summary.results).toEqual({ [`t-off:${WT}`]: 'removed' });
    expect((await entryOf('t-off'))?.cleanup?.state).toBe('removed');
  });

  it('flags a device too old for the RPC', async () => {
    await insert('t-old', autoCreated());
    answers({ error: 'Unknown device RPC method', outcome: 'unreachable', outdated: true });
    await service().retireTopics(['t-old'], 'archived');
    expect((await entryOf('t-old'))?.cleanup).toMatchObject({
      reason: 'deviceOutdated',
      state: 'pending',
    });
  });

  it("only drains the connecting device's cleanups", async () => {
    await insert('t-other', autoCreated({ boundDeviceId: 'dev-2' }));
    answers({ outcome: 'unreachable' });
    await service().retireTopics(['t-other'], 'archived');
    gateway.cleanupOwnedWorktree.mockClear();

    await service().runPendingForDevice('dev-1');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('drops a pending cleanup of a topic restored meanwhile', async () => {
    await insert('t-restored', autoCreated());
    answers({ outcome: 'unreachable' });
    await service().retireTopics(['t-restored'], 'archived');
    await db.update(topics).set({ status: 'active' }).where(eq(topics.id, 't-restored'));
    gateway.cleanupOwnedWorktree.mockClear();

    await service().runPendingForDevice('dev-1');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
    expect((await entryOf('t-restored'))?.cleanup).toBeUndefined();
  });

  it('a desktop without a gateway device id claims its cleanups and reports them back', async () => {
    await insert('t-anon', autoCreated({ boundDeviceId: undefined }));
    await service().retireTopics(['t-anon'], 'archived');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
    expect((await entryOf('t-anon'))?.cleanup?.state).toBe('pending');

    const claimed = await service().claimLocalCleanups(undefined);
    expect(claimed).toEqual([expect.objectContaining({ discard: false, topicId: 't-anon' })]);
    expect((await entryOf('t-anon'))?.cleanup?.state).toBe('running');
    // A second executor gets nothing while the claim is fresh…
    expect(await service().claimLocalCleanups(undefined)).toEqual([]);
    // …but takes over a claim whose executor died.
    now = new Date(now.getTime() + STALE_CLAIM_MS + 1);
    expect(await service().claimLocalCleanups(undefined)).toHaveLength(1);

    await service().recordCleanupResult('t-anon', WT, 'archived', { outcome: 'removed' });
    expect((await entryOf('t-anon'))?.cleanup?.state).toBe('removed');
  });
});

describe('discard / keep', () => {
  const keptDirty = () =>
    autoCreated({
      ownedWorktrees: [
        {
          branch: BRANCH,
          cleanup: { at: 'x', dirtyFiles: 2, state: 'keptDirty', trigger: 'archived' },
          createdAt: 'y',
          deviceId: 'dev-1',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
    });

  it('discards a kept-dirty worktree with force on its device', async () => {
    await insert('t-discard', keptDirty());
    answers({ outcome: 'removed' });
    const written = await service().discard('t-discard', WT);
    expect(gateway.cleanupOwnedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ discard: true, worktreePath: WT }),
    );
    expect(written?.cleanup).toMatchObject({ state: 'removed', trigger: 'discarded' });
  });

  it('only claims a discard the desktop runs itself', async () => {
    await insert('t-local', keptDirty());
    const claimed = await service().discard('t-local', WT, { local: true });
    expect(claimed?.cleanup).toMatchObject({ state: 'running', trigger: 'discarded' });
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('never discards a live worktree the cleanup has not set aside', async () => {
    await insert('t-live-discard', autoCreated(), { status: 'active' });
    await expect(service().discard('t-live-discard', WT)).resolves.toBeUndefined();
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
    expect((await entryOf('t-live-discard'))?.cleanup).toBeUndefined();
  });

  it("refuses to discard under a live run, its own or another topic's in the folder", async () => {
    await insert(
      't-run-discard',
      { ...keptDirty(), runningOperation: { operationId: 'op' } as any },
      {
        status: 'running',
      },
    );
    await expect(service().discard('t-run-discard', WT)).resolves.toBeUndefined();

    await insert('t-quiet-discard', keptDirty());
    await insert(
      't-neighbour',
      { workingDirectoryConfig: { git: { activeWorktree: WT }, path: '/code/repo' } },
      { status: 'active' },
    );
    await expect(service().discard('t-quiet-discard', WT)).resolves.toBeUndefined();
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('keep stops every later automatic cleanup', async () => {
    await insert('t-keep', keptDirty());
    expect((await service().keep('t-keep', WT))?.cleanup?.state).toBe('kept');
    await service().retireTopics(['t-keep'], 'archived');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });
});

describe('restore', () => {
  const removed = (extra: Partial<ChatTopicMetadata> = {}) =>
    autoCreated({
      ownedWorktrees: [
        {
          branch: BRANCH,
          cleanup: { at: 'x', state: 'removed', trigger: 'trashed' },
          createdAt: 'y',
          deviceId: 'dev-1',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
      ...extra,
    });

  it('checks the branch out again at the same path and clears the record', async () => {
    await insert('t-restore', removed(), { status: 'active' });
    gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'restored' });

    await expect(service().restore('t-restore', WT)).resolves.toEqual({ outcome: 'restored' });
    expect(gateway.restoreOwnedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ branch: BRANCH, deviceId: 'dev-1', worktreePath: WT }),
    );
    expect((await entryOf('t-restore'))?.cleanup).toBeUndefined();
    const [row] = await db.select().from(topics).where(eq(topics.id, 't-restore'));
    expect(row.metadata?.workingDirectoryConfig?.sessionPath).toBe(WT);
  });

  it('records a restore the desktop ran over IPC without calling the device', async () => {
    await insert('t-ipc', removed({ boundDeviceId: undefined }), { status: 'active' });
    await expect(
      service().restore('t-ipc', WT, { result: { outcome: 'restored' } }),
    ).resolves.toEqual({
      outcome: 'restored',
    });
    expect(gateway.restoreOwnedWorktree).not.toHaveBeenCalled();
  });

  it('falls back to the source repository when the branch is gone', async () => {
    await insert('t-gone', removed(), { status: 'active' });
    gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'branchMissing' });

    await expect(service().restore('t-gone', WT)).resolves.toEqual({ outcome: 'branchMissing' });
    const [row] = await db.select().from(topics).where(eq(topics.id, 't-gone'));
    expect(row.metadata?.workingDirectory).toBe('/code/repo');
    expect(row.metadata?.workingDirectoryConfig).toEqual({
      path: '/code/repo',
      repoType: 'github',
    });
    expect(row.metadata?.ownedWorktrees?.[0]?.cleanup).toMatchObject({
      reason: 'branchMissing',
      state: 'removed',
    });
  });

  it('makes a kept-dirty worktree live again when its topic comes back', async () => {
    await insert(
      't-kept-back',
      autoCreated({
        ownedWorktrees: [
          {
            branch: BRANCH,
            cleanup: { at: 'x', dirtyFiles: 1, state: 'keptDirty', trigger: 'archived' },
            createdAt: 'y',
            deviceId: 'dev-1',
            path: WT,
            sourcePath: '/code/repo',
          },
        ],
      }),
      { status: 'active' },
    );
    await expect(service().restore('t-kept-back', WT)).resolves.toEqual({ outcome: 'restored' });
    expect((await entryOf('t-kept-back'))?.cleanup).toBeUndefined();
    expect(gateway.restoreOwnedWorktree).not.toHaveBeenCalled();
  });

  it('asks the device after a failed cleanup instead of assuming the folder is there', async () => {
    const failed = (branch?: string) =>
      autoCreated({
        ownedWorktrees: [
          {
            ...(branch && { branch }),
            cleanup: { at: 'x', reason: 'Worktree cleanup timed out', state: 'failed' },
            createdAt: 'y',
            deviceId: 'dev-1',
            path: WT,
            sourcePath: '/code/repo',
          },
        ],
      });
    await insert('t-failed', failed(BRANCH), { status: 'active' });
    gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'restored' });
    await expect(service().restore('t-failed', WT)).resolves.toEqual({ outcome: 'restored' });
    expect(gateway.restoreOwnedWorktree).toHaveBeenCalledTimes(1);
    expect((await entryOf('t-failed'))?.cleanup).toBeUndefined();

    // Without a branch there is nothing to check out, but no reason to give
    // the worktree up either.
    await insert('t-failed-nobranch', failed(), { status: 'active' });
    await expect(service().restore('t-failed-nobranch', WT)).resolves.toEqual({
      outcome: 'restored',
    });
    const [row] = await db.select().from(topics).where(eq(topics.id, 't-failed-nobranch'));
    expect(row.metadata?.workingDirectoryConfig?.sessionPath).toBe(WT);
  });

  it('is a no-op for a worktree that was never removed', async () => {
    await insert('t-live', autoCreated(), { status: 'active' });
    await expect(service().restore('t-live', WT)).resolves.toEqual({ outcome: 'restored' });
    expect(gateway.restoreOwnedWorktree).not.toHaveBeenCalled();
  });
});

describe('review follow-ups', () => {
  const memberId = 'worktree-cleanup-member';
  const workspaceId = 'worktree-cleanup-ws';
  const removedOn = (extra: Partial<ChatTopicMetadata> = {}) =>
    autoCreated({
      ownedWorktrees: [
        {
          branch: BRANCH,
          cleanup: { at: now.toISOString(), state: 'running', trigger: 'archived' },
          createdAt: 'y',
          deviceId: 'dev-1',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
      ...extra,
    });

  it("presents the creation receipt only for its creator's own topic", async () => {
    const previous = process.env.KEY_VAULTS_SECRET;
    process.env.KEY_VAULTS_SECRET = 'test-secret';
    try {
      const { issueWorktreeReceipt } = await import('./receipt');
      const receipt = issueWorktreeReceipt(userId)!;
      const withReceipt = (extra: Partial<ChatTopicMetadata> = {}) =>
        autoCreated({
          workingDirectoryConfig: {
            git: {
              activeWorktree: WT,
              autoCreated: true,
              branch: BRANCH,
              ownerNonce: receipt.nonce,
              ownerToken: receipt.token,
            },
            path: '/code/repo',
            sessionPath: WT,
          },
          ...extra,
        });
      await insert('t-receipt', withReceipt());
      answers({ outcome: 'removed' });
      await service().retireTopics(['t-receipt'], 'archived');
      expect(gateway.cleanupOwnedWorktree).toHaveBeenLastCalledWith(
        expect.objectContaining({ ownerToken: receipt.token }),
      );

      await db.update(topics).set({ status: 'active' }).where(eq(topics.id, 't-receipt'));
      gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'restored' });
      await service().restore('t-receipt', WT);
      expect(gateway.restoreOwnedWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ ownerToken: receipt.token }),
      );

      // The same receipt copied into another user's topic is never presented.
      const otherId = 'worktree-cleanup-copier';
      await db.insert(users).values({ id: otherId });
      try {
        await insert('t-copied', withReceipt(), { userId: otherId });
        const copier = new WorktreeCleanupService(db, otherId, undefined, {
          gateway: gateway as any,
          now: () => now,
        });
        await copier.retireTopics(['t-copied'], 'archived');
        expect(gateway.cleanupOwnedWorktree).toHaveBeenLastCalledWith(
          expect.objectContaining({ ownerToken: undefined }),
        );
      } finally {
        await db.delete(topics).where(eq(topics.userId, otherId));
        await db.delete(users).where(eq(users.id, otherId));
      }
    } finally {
      process.env.KEY_VAULTS_SECRET = previous;
    }
  });

  it('only hands the desktop the jobs of topics the caller may act on', async () => {
    const pending = autoCreated({
      boundDeviceId: undefined,
      ownedWorktrees: [
        {
          cleanup: { at: 'x', state: 'pending', trigger: 'archived' },
          createdAt: 'y',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
    });
    await insert('t-allowed', pending);
    await insert('t-denied', pending);
    const claimed = await service().claimLocalCleanups(undefined, {
      canClaim: async (row) => row.id === 't-allowed',
    });
    expect(claimed.map((job) => job.topicId)).toEqual(['t-allowed']);
    expect((await entryOf('t-denied'))?.cleanup?.state).toBe('pending');
  });

  it('records the branch the device reports, not a stale one from creation', async () => {
    await insert('t-renamed', autoCreated());
    answers({ branch: 'lobehub/renamed', outcome: 'removed' });
    await service().retireTopics(['t-renamed'], 'archived');
    expect((await entryOf('t-renamed'))?.branch).toBe('lobehub/renamed');
  });

  it('makes a restore wait while a cleanup is still deleting the folder', async () => {
    await insert('t-busy', removedOn(), { status: 'active' });
    await expect(service().restore('t-busy', WT)).resolves.toEqual({ outcome: 'busy' });
    expect(gateway.restoreOwnedWorktree).not.toHaveBeenCalled();

    // The cleanup lands; the next ask checks the worktree out again.
    await service().recordCleanupResult('t-busy', WT, 'archived', { outcome: 'removed' });
    gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'restored' });
    await expect(service().restore('t-busy', WT)).resolves.toEqual({ outcome: 'restored' });
    expect(gateway.restoreOwnedWorktree).toHaveBeenCalledTimes(1);
  });

  it('cancels a cleanup that never ran when the topic comes back', async () => {
    await insert('t-cancel', autoCreated(), { status: 'active' });
    await db
      .update(topics)
      .set({
        metadata: autoCreated({
          ownedWorktrees: [
            {
              branch: BRANCH,
              cleanup: { at: 'x', state: 'pending', trigger: 'archived' },
              createdAt: 'y',
              deviceId: 'dev-1',
              path: WT,
              sourcePath: '/code/repo',
            },
          ],
        }),
      })
      .where(eq(topics.id, 't-cancel'));
    await expect(service().restore('t-cancel', WT)).resolves.toEqual({ outcome: 'restored' });
    expect((await entryOf('t-cancel'))?.cleanup).toBeUndefined();
    gateway.cleanupOwnedWorktree.mockClear();
    await service().runPendingForDevice('dev-1');
    expect(gateway.cleanupOwnedWorktree).not.toHaveBeenCalled();
  });

  it('hands a removed worktree on this desktop back for an IPC re-checkout', async () => {
    await insert(
      't-local',
      autoCreated({
        ownedWorktrees: [
          {
            branch: 'lobehub/renamed',
            cleanup: { at: 'x', state: 'removed', trigger: 'trashed' },
            createdAt: 'y',
            deviceId: 'dev-1',
            path: WT,
            sourcePath: '/code/repo',
          },
        ],
      }),
      { status: 'active' },
    );
    // The receipt never travels back in the answer.
    await expect(service().restore('t-local', WT, { local: true })).resolves.toEqual({
      branch: 'lobehub/renamed',
      outcome: 'needsLocal',
    });
    expect(gateway.restoreOwnedWorktree).not.toHaveBeenCalled();
  });

  it("drains a workspace device's pending cleanups for every member's topics", async () => {
    await db.insert(users).values({ id: memberId });
    await db
      .insert(workspaces)
      .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
    try {
      const pending = (deviceId?: string) =>
        autoCreated({
          ownedWorktrees: [
            {
              branch: BRANCH,
              cleanup: { at: 'x', state: 'pending', trigger: 'archived' },
              createdAt: 'y',
              ...(deviceId && { deviceId }),
              path: WT,
              sourcePath: '/code/repo',
            },
          ],
        });
      // A teammate archived a topic on the shared device while it was offline.
      await insert('t-member', pending('dev-ws'), { userId: memberId, workspaceId });
      // A teammate's desktop-only record never runs on this machine.
      await insert('t-member-local', pending(), { userId: memberId, workspaceId });
      answers({ outcome: 'removed' });

      const enroller = new WorktreeCleanupService(db, userId, workspaceId, {
        gateway: gateway as any,
        now: () => now,
      });
      expect((await enroller.runPendingForDevice('dev-ws')).results).toEqual({
        [`t-member:${WT}`]: 'removed',
      });
      expect(await enroller.claimLocalCleanups(undefined)).toEqual([]);
    } finally {
      await db.delete(topics).where(eq(topics.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, memberId));
    }
  });
});

describe('restoreOwnedWorktreeBeforeServerRun', () => {
  const removed = () =>
    autoCreated({
      ownedWorktrees: [
        {
          branch: BRANCH,
          cleanup: { at: 'x', state: 'removed', trigger: 'archived' },
          createdAt: 'y',
          deviceId: 'dev-1',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
    });

  it('brings the worktree back before a turn the server starts on its own', async () => {
    await insert('t-server-run', removed(), { status: 'completed' });
    gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'restored' });
    // The default gateway is the module singleton; route it through the mock.
    const { deviceGateway } = await import('@/server/services/deviceGateway');
    Object.assign(deviceGateway, gateway);

    const metadata = (await db.select().from(topics).where(eq(topics.id, 't-server-run')))[0]
      .metadata;
    await expect(
      restoreOwnedWorktreeBeforeServerRun({ db, metadata, topicId: 't-server-run', userId }),
    ).resolves.toBeUndefined();
    expect(gateway.restoreOwnedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ branch: BRANCH, worktreePath: WT }),
    );
    expect((await entryOf('t-server-run'))?.cleanup).toBeUndefined();
  });

  it('hands back the source-repo directory when the branch is gone', async () => {
    const { deviceGateway } = await import('@/server/services/deviceGateway');
    Object.assign(deviceGateway, gateway);
    await insert('t-server-gone', removed(), { status: 'completed' });
    gateway.restoreOwnedWorktree.mockResolvedValue({ outcome: 'branchMissing' });
    const metadata = (await db.select().from(topics).where(eq(topics.id, 't-server-gone')))[0]
      .metadata;
    const next = await restoreOwnedWorktreeBeforeServerRun({
      db,
      metadata,
      topicId: 't-server-gone',
      userId,
    });
    expect(next?.metadata?.workingDirectoryConfig).toEqual({
      path: '/code/repo',
      repoType: 'github',
    });
  });

  it('does nothing for a topic without an app-created worktree', async () => {
    await expect(
      restoreOwnedWorktreeBeforeServerRun({
        db,
        metadata: { workingDirectoryConfig: { path: '/code/repo' } },
        topicId: 'none',
        userId,
      }),
    ).resolves.toBeUndefined();
  });
});
