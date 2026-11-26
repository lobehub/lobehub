// @vitest-environment node
import type { ChatTopicMetadata, TopicScheduledRun } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';
import { withOwnedWorktreeClaim } from '../../topic/ownedWorktree';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-first-send-user';
const otherId = 'topic-first-send-other';
const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';
const SOURCE = '/code/repo';

const worktreeConfig = {
  git: {
    activeWorktree: WT,
    autoCreated: true,
    autoCreatedAt: '2026-11-16T00:00:00.000Z',
    branch: 'lobehub/quiet-hill',
    isWorktree: true,
  },
  path: SOURCE,
  sessionPath: WT,
};

const worktreeStartRun = (claimId = 'claim-1'): TopicScheduledRun =>
  ({
    claim: {
      claimedAt: '2026-11-16T00:00:00.000Z',
      expiresAt: '2026-11-16T00:05:00.000Z',
      id: claimId,
    },
    createdAt: '2026-11-16T00:00:00.000Z',
    kind: 'worktree_start',
    operationId: 'op-1',
    runAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    userMessageId: 'msg-1',
  }) as TopicScheduledRun;

const insert = (
  id: string,
  metadata: ChatTopicMetadata,
  extra: {
    agentId?: string | null;
    isDeleted?: boolean;
    sessionId?: string | null;
    status?: 'active' | 'completed' | 'running' | 'scheduled';
    userId?: string;
  } = {},
) =>
  serverDB.insert(topics).values({
    agentId: extra.agentId ?? null,
    id,
    isDeleted: extra.isDeleted ?? null,
    deletedAt: extra.isDeleted ? new Date() : null,
    metadata,
    sessionId: extra.sessionId ?? null,
    status: extra.status ?? 'scheduled',
    userId: extra.userId ?? userId,
  });

const autoCreatedForClear = (): ChatTopicMetadata => ({
  workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
});

const readTopic = async (id: string) =>
  (await serverDB.select().from(topics).where(eq(topics.id, id)))[0];

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherId }]);
  await serverDB.insert(agents).values([{ id: 'agent-1', userId }]);
  await serverDB.insert(sessions).values({ id: 'session-1', userId });
});

afterEach(async () => {
  await serverDB.delete(sessions).where(inArray(sessions.id, ['session-1']));
  await serverDB.delete(agents).where(inArray(agents.id, ['agent-1']));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherId]));
});

const model = () => new TopicModel(serverDB, userId);

const checkout = (id: string, claimId?: string) =>
  model().recordFirstSendWorktreeCheckout(id, {
    claimId,
    deviceId: 'dev-9',
    workingDirectoryConfig: worktreeConfig,
  });

describe('recordFirstSendWorktreeCheckout', () => {
  it('declines for a topic that does not exist or belongs to someone else', async () => {
    expect(await checkout('missing', 'claim-1')).toEqual({ canDispatch: false });

    await insert('t-other', { scheduledRun: worktreeStartRun() }, { userId: otherId });
    expect(await checkout('t-other', 'claim-1')).toEqual({ canDispatch: false });
    expect((await readTopic('t-other'))?.metadata?.scheduledRun).toBeTruthy();
  });

  it('dispatches a scheduled topic that holds the claim and records the checkout', async () => {
    await insert('t-dispatch', {
      scheduledRun: worktreeStartRun('claim-1'),
      workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
    });

    expect(await checkout('t-dispatch', 'claim-1')).toEqual({ canDispatch: true });

    const topic = await readTopic('t-dispatch');
    expect(topic?.metadata?.ownedWorktrees).toEqual([
      {
        branch: 'lobehub/quiet-hill',
        createdAt: '2026-11-16T00:00:00.000Z',
        deviceId: 'dev-9',
        path: WT,
        sourcePath: SOURCE,
      },
    ]);
    // A live topic keeps its schedule: only a retirement clears the payload.
    expect(topic?.metadata?.scheduledRun?.kind).toBe('worktree_start');
    expect(topic?.status).toBe('scheduled');
  });

  it('records an archived cleanup and clears the schedule of the claimed run', async () => {
    await insert(
      't-archived',
      {
        scheduledRun: worktreeStartRun('claim-1'),
        workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
      },
      { status: 'completed' },
    );

    expect(await checkout('t-archived', 'claim-1')).toEqual({
      canDispatch: false,
      cleanupTrigger: 'archived',
    });

    const topic = await readTopic('t-archived');
    expect(topic?.metadata?.ownedWorktrees?.[0]?.cleanup).toMatchObject({
      state: 'pending',
      trigger: 'archived',
    });
    expect(topic?.metadata?.scheduledRun).toBeNull();
    expect(topic?.status).toBe('completed');
  });

  it('records a trashed cleanup, clears the schedule and re-activates the topic', async () => {
    await insert(
      't-trashed',
      {
        scheduledRun: worktreeStartRun('claim-1'),
        workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
      },
      { isDeleted: true },
    );

    expect(await checkout('t-trashed', 'claim-1')).toEqual({
      canDispatch: false,
      cleanupTrigger: 'trashed',
    });

    const topic = await readTopic('t-trashed');
    expect(topic?.metadata?.ownedWorktrees?.[0]?.cleanup).toMatchObject({
      state: 'pending',
      trigger: 'trashed',
    });
    expect(topic?.metadata?.scheduledRun).toBeNull();
    // Back to `active`: the row now has to be re-read as a normal trashed topic.
    expect(topic?.status).toBe('active');
  });

  it('keeps the schedule of a retired topic it does not hold the claim for', async () => {
    await insert(
      't-no-claim',
      {
        scheduledRun: worktreeStartRun('claim-1'),
        workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
      },
      { isDeleted: true },
    );

    expect(await checkout('t-no-claim', 'claim-2')).toEqual({
      canDispatch: false,
      cleanupTrigger: 'trashed',
    });

    const topic = await readTopic('t-no-claim');
    // Not the claimant: the dispatcher owning `claim-1` still owns the payload.
    expect(topic?.metadata?.scheduledRun?.kind).toBe('worktree_start');
    expect(topic?.status).toBe('scheduled');
    // The cleanup is still recorded — the device may remove the folder, not the run.
    expect(topic?.metadata?.ownedWorktrees?.[0]?.cleanup).toMatchObject({ trigger: 'trashed' });
  });

  it('never overwrites a cleanup that already ran', async () => {
    await insert(
      't-kept',
      {
        ownedWorktrees: [
          {
            cleanup: { at: 'earlier', state: 'kept', trigger: 'archived' },
            createdAt: '2026-11-15T00:00:00.000Z',
            path: WT,
            sourcePath: SOURCE,
          },
        ],
        scheduledRun: worktreeStartRun('claim-1'),
        workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
      },
      { status: 'completed' },
    );

    expect(await checkout('t-kept', 'claim-1')).toEqual({
      canDispatch: false,
      cleanupTrigger: 'archived',
    });

    const topic = await readTopic('t-kept');
    expect(topic?.metadata?.ownedWorktrees?.[0]?.cleanup).toMatchObject({
      at: 'earlier',
      state: 'kept',
    });
  });

  it('declines a claim of another kind or another id, leaving the topic untouched', async () => {
    const delayedStart = {
      claim: {
        claimedAt: '2026-11-16T00:00:00.000Z',
        expiresAt: '2026-11-16T00:05:00.000Z',
        id: 'claim-1',
      },
      createdAt: '2026-11-16T00:00:00.000Z',
      kind: 'delayed_start',
      runAt: '2026-11-16T00:00:00.000Z',
      updatedAt: '2026-11-16T00:00:00.000Z',
      userMessageId: 'msg-1',
    } as TopicScheduledRun;
    await insert('t-delayed', { scheduledRun: delayedStart }, { status: 'scheduled' });

    expect(await checkout('t-delayed', 'claim-1')).toEqual({ canDispatch: false });
    expect((await readTopic('t-delayed'))?.metadata?.scheduledRun?.kind).toBe('delayed_start');
  });

  it('records a checkout without dispatching when no claim is passed', async () => {
    await insert('t-anon', {
      workingDirectoryConfig: worktreeConfig as ChatTopicMetadata['workingDirectoryConfig'],
    });

    expect(await checkout('t-anon')).toEqual({ canDispatch: false });

    const topic = await readTopic('t-anon');
    expect(topic?.metadata?.ownedWorktrees?.[0]).toMatchObject({ deviceId: 'dev-9', path: WT });
    expect(topic?.metadata?.ownedWorktrees?.[0]?.cleanup).toBeUndefined();
  });
});

describe('owned worktree lookups by id and parent', () => {
  it('answers an empty id list without a query', async () => {
    expect(await model().findOwnedWorktreeTopics([])).toEqual([]);
    await insert('by-id', {
      ownedWorktrees: [{ createdAt: 'y', path: WT, sourcePath: SOURCE }],
    });
    expect((await model().findOwnedWorktreeTopics(['by-id'])).map((row) => row.id)).toEqual([
      'by-id',
    ]);
    expect(await model().findWaitingCleanupTopicsUnder({ agentIds: [], topicIds: [] })).toEqual([]);
  });

  it('finds waiting cleanups under agents, by topic id, and both', async () => {
    const waiting = (): ChatTopicMetadata => ({
      ownedWorktrees: [
        {
          cleanup: { at: 'x', state: 'pending' },
          createdAt: 'y',
          path: WT,
          sourcePath: SOURCE,
        },
      ],
    });
    await insert('w-agent', waiting(), { agentId: 'agent-1' });
    await insert('w-session', waiting(), { sessionId: 'session-1' });
    await insert('w-idle', {
      ownedWorktrees: [{ createdAt: 'y', path: '/other', sourcePath: SOURCE }],
    });

    expect(
      (await model().findWaitingCleanupTopicsUnder({ agentIds: ['agent-1'], topicIds: [] })).map(
        (row) => row.id,
      ),
    ).toEqual(['w-agent']);
    expect(
      (await model().findWaitingCleanupTopicsUnder({ agentIds: [], topicIds: ['w-session'] })).map(
        (row) => row.id,
      ),
    ).toEqual(['w-session']);
    const both = await model().findWaitingCleanupTopicsUnder({
      agentIds: ['agent-1'],
      topicIds: ['w-session'],
    });
    expect(both.map((row) => row.id).sort()).toEqual(['w-agent', 'w-session']);
  });

  it('drops rows whose pending cleanup belongs to a registered device', async () => {
    await insert('p-bound', {
      ownedWorktrees: [
        {
          cleanup: { at: 'x', state: 'pending' },
          createdAt: 'y',
          deviceId: 'dev-2',
          path: WT,
          sourcePath: SOURCE,
        },
      ],
    });

    expect(await model().findPendingOwnedWorktreeTopics(undefined)).toEqual([]);
  });

  it('counts a worktree no topic was excluded from', async () => {
    await insert('live-only', {
      workingDirectoryConfig: { git: { activeWorktree: WT }, path: SOURCE },
    });

    expect(await model().countLiveTopicsUsingWorktree({ excludeIds: [], path: WT })).toBe(1);
  });

  it('accepts a snapshot that clears the whole metadata', async () => {
    await insert('t-clear', autoCreatedForClear());

    await model().update('t-clear', { metadata: null });

    expect((await readTopic('t-clear'))?.metadata).toBeNull();
  });

  it('leaves a record alone when the path is not in it', async () => {
    await insert('t-no-path', {
      ownedWorktrees: [{ createdAt: 'y', path: '/other', sourcePath: SOURCE }],
    });

    expect(
      await model().updateOwnedWorktree('t-no-path', WT, () => ({
        createdAt: 'z',
        path: WT,
        sourcePath: SOURCE,
      })),
    ).toBeUndefined();
  });
});

describe('owned worktree helpers', () => {
  it('leaves a missing metadata payload alone', () => {
    expect(withOwnedWorktreeClaim(null)).toBeNull();
    expect(withOwnedWorktreeClaim(undefined)).toBeUndefined();
  });

  it('finds only the anonymous cleanups that are still pending or running', async () => {
    const entry = (cleanup: string, extra: Record<string, unknown> = {}) => ({
      ownedWorktrees: [
        { cleanup: { at: 'x', state: cleanup as never }, createdAt: 'y', path: WT, ...extra },
      ],
    });
    await insert('anon-running', entry('running'));
    await insert('anon-removed', entry('removed'));

    expect((await model().findPendingOwnedWorktreeTopics(undefined)).map((row) => row.id)).toEqual([
      'anon-running',
    ]);
  });

  it('rewrites one record and leaves its sibling untouched', async () => {
    await insert('t-two', {
      ownedWorktrees: [
        { createdAt: 'y', path: '/first', sourcePath: SOURCE },
        { createdAt: 'y', path: WT, sourcePath: SOURCE },
      ],
    });

    const written = await model().updateOwnedWorktree('t-two', WT, (current) => ({
      ...current,
      deviceId: 'dev-7',
    }));

    expect(written?.deviceId).toBe('dev-7');
    expect((await readTopic('t-two'))?.metadata?.ownedWorktrees).toHaveLength(2);
    expect((await readTopic('t-two'))?.metadata?.ownedWorktrees?.[0]?.path).toBe('/first');
  });
});
