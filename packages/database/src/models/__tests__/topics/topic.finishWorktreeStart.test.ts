// @vitest-environment node
import type { ChatTopicMetadata, TopicScheduledRun } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-finish-wt-user';

const insert = (
  id: string,
  metadata: ChatTopicMetadata,
  extra: { isDeleted?: boolean; status?: 'active' | 'completed' | 'scheduled' } = {},
) =>
  serverDB.insert(topics).values({
    id,
    isDeleted: extra.isDeleted ?? null,
    deletedAt: extra.isDeleted ? new Date() : null,
    metadata,
    status: extra.status ?? 'scheduled',
    userId,
  });

const readTopic = async (id: string) =>
  (await serverDB.select().from(topics).where(eq(topics.id, id)))[0];

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

const finish = (
  id: string,
  claimId: string,
  result: { error?: string; retryAt?: string; retryable?: boolean; success: boolean },
) => TopicModel.finishWorktreeStart(serverDB, id, claimId, result);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('TopicModel.finishWorktreeStart', () => {
  it('does nothing for a missing topic, a stale claim, or another kind of run', async () => {
    await finish('missing', 'claim-1', { success: true });
    expect(await readTopic('missing')).toBeUndefined();

    await insert('t-stale', { scheduledRun: worktreeStartRun('claim-1') });
    await finish('t-stale', 'claim-2', { success: true });
    expect((await readTopic('t-stale'))?.status).toBe('scheduled');
    expect((await readTopic('t-stale'))?.metadata?.scheduledRun?.kind).toBe('worktree_start');

    const delayedStart = {
      ...worktreeStartRun('claim-1'),
      kind: 'delayed_start',
    } as TopicScheduledRun;
    await insert('t-delayed', { scheduledRun: delayedStart });
    await finish('t-delayed', 'claim-1', { success: true });
    expect((await readTopic('t-delayed'))?.status).toBe('scheduled');
  });

  it('clears the schedule and starts running the claimed first send', async () => {
    await insert('t-ok', { scheduledRun: worktreeStartRun('claim-1') });

    await finish('t-ok', 'claim-1', { success: true });

    const topic = await readTopic('t-ok');
    expect(topic?.metadata?.scheduledRun).toBeNull();
    expect(topic?.status).toBe('running');
  });

  it('re-arms the same run for the retry time and waits for the device', async () => {
    await insert('t-retry', { scheduledRun: worktreeStartRun('claim-1') });

    await finish('t-retry', 'claim-1', {
      retryAt: '2026-11-16T01:00:00.000Z',
      success: false,
    });

    const topic = await readTopic('t-retry');
    expect(topic?.metadata?.scheduledRun).toMatchObject({
      runAt: '2026-11-16T01:00:00.000Z',
      waitingForDevice: true,
    });
    expect(topic?.metadata?.scheduledRun?.claim).toBeFalsy();
    expect(topic?.status).toBe('scheduled');
  });

  it('fails a scheduled first send that has no retry time', async () => {
    await insert('t-failed', { scheduledRun: worktreeStartRun('claim-1') });

    await finish('t-failed', 'claim-1', { error: 'checkout failed', success: false });

    const topic = await readTopic('t-failed');
    expect(topic?.metadata?.scheduledRun).toMatchObject({ error: 'checkout failed' });
    expect(topic?.metadata?.scheduledRun?.claim).toBeFalsy();
    expect(topic?.status).toBe('failed');
  });

  it('fails a first send the user started on a live topic', async () => {
    await insert('t-live', { scheduledRun: worktreeStartRun('claim-1') }, { status: 'active' });

    await finish('t-live', 'claim-1', { error: 'checkout failed', success: false });

    expect((await readTopic('t-live'))?.status).toBe('failed');
  });

  it('records an empty error when the failed dispatch carries none', async () => {
    await insert('t-failed-bare', { scheduledRun: worktreeStartRun('claim-1') });

    await finish('t-failed-bare', 'claim-1', { success: false });

    expect((await readTopic('t-failed-bare'))?.metadata?.scheduledRun).toMatchObject({ error: '' });
  });

  it('leaves a live topic active when the claim succeeded', async () => {
    await insert('t-live-ok', { scheduledRun: worktreeStartRun('claim-1') }, { status: 'active' });

    await finish('t-live-ok', 'claim-1', { success: true });

    expect((await readTopic('t-live-ok'))?.status).toBe('active');
    expect((await readTopic('t-live-ok'))?.metadata?.scheduledRun).toBeNull();
  });
});

describe('claimScheduledTopic', () => {
  const claim = {
    claimedAt: '2026-11-16T00:10:00.000Z',
    expiresAt: '2026-11-16T00:15:00.000Z',
    id: 'dispatcher-1',
  };
  const now = new Date('2026-11-16T00:10:00.000Z');

  it('claims a due worktree start and clears its waiting flag', async () => {
    await insert('c-due', {
      scheduledRun: { ...worktreeStartRun(), waitingForDevice: true } as TopicScheduledRun,
    });

    expect(await TopicModel.claimScheduledTopic(serverDB, 'c-due', claim, now)).toBe(true);

    const topic = await readTopic('c-due');
    expect(topic?.metadata?.scheduledRun?.claim?.id).toBe('dispatcher-1');
    expect(topic?.metadata?.scheduledRun).toMatchObject({ waitingForDevice: false });
  });

  it('refuses a worktree start that is not due yet', async () => {
    await insert('c-future', {
      scheduledRun: {
        ...worktreeStartRun(),
        runAt: '2026-11-16T01:00:00.000Z',
      } as TopicScheduledRun,
    });

    expect(await TopicModel.claimScheduledTopic(serverDB, 'c-future', claim, now)).toBe(false);
    expect((await readTopic('c-future'))?.metadata?.scheduledRun?.claim?.id).toBe('claim-1');
  });

  it('refuses a topic claimed by another live lease, and one with no payload', async () => {
    await insert('c-live', {
      scheduledRun: {
        ...worktreeStartRun(),
        claim: { claimedAt: 'x', expiresAt: '2026-11-16T00:20:00.000Z', id: 'other' },
      } as TopicScheduledRun,
    });
    expect(await TopicModel.claimScheduledTopic(serverDB, 'c-live', claim, now)).toBe(false);

    await insert('c-empty', {});
    expect(await TopicModel.claimScheduledTopic(serverDB, 'c-empty', claim, now)).toBe(false);
    expect(await TopicModel.claimScheduledTopic(serverDB, 'c-missing', claim, now)).toBe(false);
  });
});

describe('getDueScheduledTopics', () => {
  const now = new Date('2026-11-16T00:10:00.000Z');

  it('selects due rows, and narrows to one topic id when asked', async () => {
    await insert('d-due', {
      scheduledRun: {
        ...worktreeStartRun(),
        claim: undefined,
        runAt: '2026-11-16T00:00:00.000Z',
      } as TopicScheduledRun,
    });
    await insert('d-later', {
      scheduledRun: {
        ...worktreeStartRun(),
        claim: undefined,
        runAt: '2026-11-16T02:00:00.000Z',
      } as TopicScheduledRun,
    });

    const all = await TopicModel.getDueScheduledTopics(serverDB, now);
    expect(all.map((row) => row.id)).toContain('d-due');
    expect(all.map((row) => row.id)).not.toContain('d-later');

    const narrowed = await TopicModel.getDueScheduledTopics(serverDB, now, 'd-later');
    expect(narrowed).toEqual([]);
    const only = await TopicModel.getDueScheduledTopics(serverDB, now, 'd-due');
    expect(only.map((row) => row.id)).toEqual(['d-due']);
  });
});
