// @vitest-environment node
import type { ChatTopicMetadata } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-owned-wt-user';
const otherId = 'topic-owned-wt-other';
const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';

const autoCreated = (extra: Partial<ChatTopicMetadata> = {}): ChatTopicMetadata => ({
  boundDeviceId: 'dev-1',
  workingDirectory: WT,
  workingDirectoryConfig: {
    git: {
      activeWorktree: WT,
      autoCreated: true,
      autoCreatedAt: '2026-11-16T00:00:00.000Z',
      branch: 'lobehub/quiet-hill',
      isWorktree: true,
    },
    path: '/code/repo',
    sessionPath: WT,
  },
  ...extra,
});

const insert = (
  id: string,
  metadata: ChatTopicMetadata,
  extra: { isDeleted?: boolean; status?: 'active' | 'completed'; userId?: string } = {},
) =>
  serverDB.insert(topics).values({
    id,
    isDeleted: extra.isDeleted ?? null,
    deletedAt: extra.isDeleted ? new Date() : null,
    metadata,
    status: extra.status ?? 'active',
    userId: extra.userId ?? userId,
  });

const readMetadata = async (id: string) =>
  (await serverDB.select().from(topics).where(eq(topics.id, id)))[0]?.metadata;

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherId]));
});

const model = () => new TopicModel(serverDB, userId);

describe('ownedWorktrees claim', () => {
  it('is recorded when a topic is created on a worktree the app made', async () => {
    const topic = await model().create({ metadata: autoCreated(), title: 't' });
    expect(topic.metadata?.ownedWorktrees).toEqual([
      {
        branch: 'lobehub/quiet-hill',
        createdAt: '2026-11-16T00:00:00.000Z',
        deviceId: 'dev-1',
        path: WT,
        sourcePath: '/code/repo',
      },
    ]);
  });

  it('is recorded when the client patches the working directory in, and survives a later move', async () => {
    await insert('t-patch', { boundDeviceId: 'dev-1' });
    await model().updateMetadata('t-patch', {
      workingDirectoryConfig: autoCreated().workingDirectoryConfig,
    });
    expect((await readMetadata('t-patch'))?.ownedWorktrees?.[0]?.path).toBe(WT);

    // The agent moves to another worktree: the marker goes, the claim stays.
    await model().updateMetadata('t-patch', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/elsewhere', branch: 'feat/x' },
        path: '/code/repo',
        sessionPath: WT,
      },
    });
    const metadata = await readMetadata('t-patch');
    expect(metadata?.workingDirectoryConfig?.git?.autoCreated).toBeUndefined();
    expect(metadata?.ownedWorktrees?.map((entry) => entry.path)).toEqual([WT]);
  });

  it('a metadata patch or snapshot never overwrites the recorded cleanup state', async () => {
    await insert('t-keep', {
      ...autoCreated(),
      ownedWorktrees: [
        {
          cleanup: { at: 'x', state: 'kept' },
          createdAt: 'y',
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
    });
    await model().updateMetadata('t-keep', { ownedWorktrees: [] } as any);
    expect((await readMetadata('t-keep'))?.ownedWorktrees?.[0]?.cleanup?.state).toBe('kept');

    await model().update('t-keep', { metadata: { workingDirectory: '/x' } });
    const metadata = await readMetadata('t-keep');
    expect(metadata?.workingDirectory).toBe('/x');
    expect(metadata?.ownedWorktrees?.[0]?.cleanup?.state).toBe('kept');
  });
});

describe('legacy claims survive a directory change', () => {
  // Created before `ownedWorktrees`: only the old markers say the app made it.
  const legacy = () =>
    serverDB.insert(topics).values({ id: 't-legacy-move', metadata: autoCreated(), userId });
  const moved = {
    workingDirectoryConfig: { git: { activeWorktree: '/elsewhere' }, path: '/code/repo' },
  };

  it('is resolved before a metadata patch replaces the markers', async () => {
    await legacy();
    await model().updateMetadata('t-legacy-move', moved);
    expect((await readMetadata('t-legacy-move'))?.ownedWorktrees?.map((e) => e.path)).toEqual([WT]);
  });

  it('is resolved before a metadata snapshot replaces the markers', async () => {
    await legacy();
    await model().update('t-legacy-move', { metadata: moved });
    expect((await readMetadata('t-legacy-move'))?.ownedWorktrees?.map((e) => e.path)).toEqual([WT]);
  });
});

describe('updateOwnedWorktree', () => {
  it('backfills a topic that predates the record and writes the new state', async () => {
    // Created before `ownedWorktrees` existed: only the PR B markers are there.
    await serverDB
      .insert(topics)
      .values({ id: 't-legacy', metadata: autoCreated(), status: 'completed', userId });

    const written = await model().updateOwnedWorktree('t-legacy', WT, (entry) => ({
      ...entry,
      cleanup: { at: 'now', state: 'removed', trigger: 'archived' },
    }));
    expect(written).toMatchObject({ branch: 'lobehub/quiet-hill', deviceId: 'dev-1', path: WT });
    expect((await readMetadata('t-legacy'))?.ownedWorktrees).toEqual([
      expect.objectContaining({ cleanup: { at: 'now', state: 'removed', trigger: 'archived' } }),
    ]);
  });

  it('reaches trashed topics, and a declined update writes nothing', async () => {
    await insert('t-trash', autoCreated(), { isDeleted: true });
    expect(await model().updateOwnedWorktree('t-trash', WT, () => undefined)).toBeUndefined();
    const written = await model().updateOwnedWorktree('t-trash', WT, (entry) => ({
      ...entry,
      cleanup: { at: 'now', state: 'pending' },
    }));
    expect(written?.cleanup?.state).toBe('pending');
  });

  it("does not touch another user's topic", async () => {
    await insert('t-other', autoCreated(), { userId: otherId });
    expect(
      await model().updateOwnedWorktree('t-other', WT, (entry) => ({
        ...entry,
        cleanup: { at: 'now', state: 'removed' },
      })),
    ).toBeUndefined();
  });
});

describe('cleanup lookups', () => {
  const pending = (deviceId?: string): ChatTopicMetadata => ({
    ownedWorktrees: [
      {
        cleanup: { at: 'x', state: 'pending' },
        createdAt: 'y',
        ...(deviceId && { deviceId }),
        path: WT,
        sourcePath: '/code/repo',
      },
    ],
  });

  it('finds pending cleanups per device, and the anonymous-desktop ones', async () => {
    await insert('p-dev1', pending('dev-1'), { isDeleted: true, status: 'completed' });
    await insert('p-dev2', pending('dev-2'), { status: 'completed' });
    await insert('p-anon', pending(), { status: 'completed' });
    await insert('p-done', autoCreated());

    expect((await model().findPendingOwnedWorktreeTopics('dev-1')).map((r) => r.id)).toEqual([
      'p-dev1',
    ]);
    expect((await model().findPendingOwnedWorktreeTopics(undefined)).map((r) => r.id)).toEqual([
      'p-anon',
    ]);
  });

  it('counts live topics still using the worktree, not archived or trashed ones', async () => {
    await insert('owner', autoCreated(), { status: 'completed' });
    await insert('archived-user', autoCreated(), { status: 'completed' });
    await insert('trashed-user', autoCreated(), { isDeleted: true });
    expect(await model().countLiveTopicsUsingWorktree({ excludeIds: ['owner'], path: WT })).toBe(0);

    await insert('live-user', {
      workingDirectoryConfig: { path: '/code/repo', sessionPath: `${WT}/` },
    });
    await insert('live-active', {
      workingDirectoryConfig: { git: { activeWorktree: WT }, path: '/code/repo' },
    });
    // The same folder however its path ends.
    expect(await model().countLiveTopicsUsingWorktree({ excludeIds: ['owner'], path: WT })).toBe(2);
    expect(
      await model().countLiveTopicsUsingWorktree({ excludeIds: ['owner'], path: `${WT}/` }),
    ).toBe(2);
  });

  it('still counts an archived or trashed topic whose run is going on in the folder', async () => {
    const running = {
      runningOperation: { assistantMessageId: 'm', operationId: 'op', startedAt: 'x' },
      workingDirectoryConfig: { git: { activeWorktree: WT }, path: '/code/repo' },
    } as ChatTopicMetadata;
    await insert('archived-running', running, { status: 'completed' });
    await insert('trashed-running', running, { isDeleted: true });
    await insert(
      'archived-idle',
      {
        workingDirectoryConfig: { git: { activeWorktree: WT }, path: '/code/repo' },
      },
      { status: 'completed' },
    );
    expect(await model().countLiveTopicsUsingWorktree({ excludeIds: ['owner'], path: WT })).toBe(2);
  });

  it('counts a live topic that picked the worktree folder itself as its directory', async () => {
    await insert('picked-config', { workingDirectoryConfig: { path: WT } });
    await insert('picked-legacy', { workingDirectory: WT });
    expect(await model().countLiveTopicsUsingWorktree({ excludeIds: ['owner'], path: WT })).toBe(2);
  });

  it('counts a topic working in a folder below the worktree, not in a look-alike sibling', async () => {
    await insert('below', { workingDirectoryConfig: { path: `${WT}/packages/foo` } });
    await insert('sibling', { workingDirectoryConfig: { path: `${WT}-other/packages/foo` } });
    await insert('underscore', { workingDirectory: `${WT.slice(0, -1)}_/x` });
    expect(await model().countLiveTopicsUsingWorktree({ excludeIds: ['owner'], path: WT })).toBe(1);
  });

  it('finds the owners of a worktree path, trashed ones included', async () => {
    await insert('o-1', { ...autoCreated(), ...pending('dev-1') }, { isDeleted: true });
    await insert('o-2', { workingDirectoryConfig: { path: '/code/repo' } });
    expect((await model().findOwnersOfWorktree(WT)).map((r) => r.id)).toEqual(['o-1']);
  });
});
