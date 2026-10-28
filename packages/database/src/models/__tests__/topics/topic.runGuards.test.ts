// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';
import { ABANDONED_OPERATION_TTL_MS } from '../../topic/runningOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-run-guards-user';
const otherUserId = 'topic-run-guards-other';
const topicId = 'topic-run-guards-topic';
const otherTopicId = 'topic-run-guards-other-topic';
const operationId = 'topic-run-guards-operation';

const topicModel = new TopicModel(serverDB, userId);

const readMetadata = async (id = topicId) => {
  const row = await serverDB.query.topics.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  return row?.metadata;
};

const readStatus = async (id = topicId) => {
  const row = await serverDB.query.topics.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  return row?.status;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  // agent_operations.user_id has no FK, so the row would outlive its owner.
  await serverDB.delete(agentOperations).where(inArray(agentOperations.id, [operationId]));
  // Topics cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('TopicModel running-operation guards', () => {
  it('reports the corrected settle with the hetero message the late callback owns', async () => {
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: {
        heteroCurrentMsgId: { msgId: 'msg-late', operationId: 'op-root' },
        lastSettledOperationId: 'op-root',
      },
      status: 'unread',
      userId,
    });

    const result = await topicModel.settleRunningOperation(topicId, 'op-root', 'active');

    expect(result).toEqual({ assistantMessageId: 'msg-late', status: 'corrected' });
    expect(await readStatus()).toBe('active');
  });

  it('refuses to append a child under a parent that does not own the topic', async () => {
    const runningOperation = { assistantMessageId: 'msg-root', operationId: 'op-root' };
    await serverDB.insert(topics).values({ id: topicId, metadata: { runningOperation }, userId });

    const child = { assistantMessageId: 'msg-child', operationId: 'op-child' };

    expect(await topicModel.appendRunningOperationChild(topicId, 'op-stale', child)).toBe(false);
    expect(await topicModel.appendRunningOperationChild('missing-topic', 'op-root', child)).toBe(
      false,
    );
    expect((await readMetadata())?.runningOperation).toEqual(runningOperation);
  });

  it('refuses to patch a topic with no marker or an operation it does not carry', async () => {
    await serverDB.insert(topics).values([
      { id: otherTopicId, metadata: {}, userId },
      {
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'msg-root',
            childOperations: [{ assistantMessageId: 'msg-child', operationId: 'op-child' }],
            operationId: 'op-root',
          },
        },
        userId,
      },
    ]);

    expect(await topicModel.patchRunningOperation('missing-topic', 'op-root', {})).toBe(false);
    expect(await topicModel.patchRunningOperation(otherTopicId, 'op-root', {})).toBe(false);
    expect(await topicModel.patchRunningOperation(topicId, 'op-unknown', { scope: 'x' })).toBe(
      false,
    );
    expect((await readMetadata())?.runningOperation?.childOperations).toEqual([
      { assistantMessageId: 'msg-child', operationId: 'op-child' },
    ]);
  });

  it('refuses to patch a non-root operation when the marker has no children', async () => {
    const runningOperation = { assistantMessageId: 'msg-root', operationId: 'op-root' };
    await serverDB.insert(topics).values({ id: topicId, metadata: { runningOperation }, userId });

    expect(await topicModel.patchRunningOperation(topicId, 'op-child', { scope: 'x' })).toBe(false);
    expect((await readMetadata())?.runningOperation).toEqual(runningOperation);
  });

  it('points the root operation and hetero anchor at a new assistant message', async () => {
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: {
        runningOperation: { assistantMessageId: 'msg-old', operationId: 'op-root', scope: 'main' },
      },
      userId,
    });

    const updated = await topicModel.updateRunningOperationAssistantMessage(
      topicId,
      'op-root',
      'msg-new',
    );

    expect(updated).toBe(true);
    expect(await readMetadata()).toEqual({
      heteroCurrentMsgId: { msgId: 'msg-new', operationId: 'op-root' },
      runningOperation: { assistantMessageId: 'msg-new', operationId: 'op-root', scope: 'main' },
    });
  });

  it('leaves the assistant message alone when the topic or operation is unknown', async () => {
    await serverDB.insert(topics).values([
      { id: otherTopicId, metadata: {}, userId },
      {
        id: topicId,
        metadata: { runningOperation: { assistantMessageId: 'msg-root', operationId: 'op-root' } },
        userId,
      },
    ]);

    expect(
      await topicModel.updateRunningOperationAssistantMessage('missing-topic', 'op-root', 'm'),
    ).toBe(false);
    expect(
      await topicModel.updateRunningOperationAssistantMessage(otherTopicId, 'op-root', 'm'),
    ).toBe(false);
    // No children at all, so a non-root id can never match.
    expect(await topicModel.updateRunningOperationAssistantMessage(topicId, 'op-child', 'm')).toBe(
      false,
    );
    expect(await readMetadata()).toEqual({
      runningOperation: { assistantMessageId: 'msg-root', operationId: 'op-root' },
    });
  });

  it('takes the root operation off the topic and returns it', async () => {
    const runningOperation = { assistantMessageId: 'msg-root', operationId: 'op-root' };
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: { boundDeviceId: 'device-1', runningOperation },
      userId,
    });

    const taken = await topicModel.takeRunningOperation(topicId, 'op-root');

    expect(taken).toEqual({ isRoot: true, operation: runningOperation });
    expect(await readMetadata()).toEqual({ boundDeviceId: 'device-1', runningOperation: null });
  });

  it('takes nothing from a missing topic or one without a marker', async () => {
    await serverDB.insert(topics).values({ id: topicId, metadata: {}, userId });

    expect(await topicModel.takeRunningOperation('missing-topic', 'op-root')).toBeUndefined();
    expect(await topicModel.takeRunningOperation(topicId, 'op-root')).toBeUndefined();
  });

  it('does not touch another user’s topic', async () => {
    const runningOperation = { assistantMessageId: 'msg-root', operationId: 'op-root' };
    await serverDB
      .insert(topics)
      .values({ id: otherTopicId, metadata: { runningOperation }, userId: otherUserId });

    expect(await topicModel.takeRunningOperation(otherTopicId, 'op-root')).toBeUndefined();
    expect((await readMetadata(otherTopicId))?.runningOperation).toEqual(runningOperation);
  });
});

describe('TopicModel task-callback reservation past a dead run', () => {
  const runningOperation = {
    assistantMessageId: 'msg-dead',
    operationId,
    startedAt: new Date().toISOString(),
  };
  const longAgo = new Date(Date.now() - ABANDONED_OPERATION_TTL_MS - 60_000);

  const expectReserved = async () => {
    expect(await topicModel.tryReserveTaskCallback(topicId, 'callback-msg')).toBe(true);
    expect((await readMetadata())?.taskCallbackReservation?.messageId).toBe('callback-msg');
  };

  it('reserves a topic whose marker points at a finished operation', async () => {
    await serverDB.insert(topics).values({ id: topicId, metadata: { runningOperation }, userId });
    await serverDB
      .insert(agentOperations)
      .values({ id: operationId, status: 'done', topicId, userId });

    await expectReserved();
  });

  it('reserves a topic whose operation still claims running past the abandoned TTL', async () => {
    await serverDB.insert(topics).values({ id: topicId, metadata: { runningOperation }, userId });
    await serverDB
      .insert(agentOperations)
      .values({ createdAt: longAgo, id: operationId, status: 'running', topicId, userId });

    await expectReserved();
  });

  it('reserves a topic whose row-less marker was stamped before the abandoned TTL', async () => {
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: { runningOperation: { ...runningOperation, startedAt: longAgo.toISOString() } },
      userId,
    });

    await expectReserved();
  });

  it('reserves a topic whose row-less marker carries no start stamp', async () => {
    const { startedAt: _startedAt, ...unstamped } = runningOperation;
    await serverDB
      .insert(topics)
      .values({ id: topicId, metadata: { runningOperation: unstamped }, userId });

    await expectReserved();
  });
});

describe('TopicModel task-callback guards', () => {
  const repair = (
    overrides: Partial<Parameters<TopicModel['repairAgentInterventionContinuation']>[0]>,
  ) =>
    topicModel.repairAgentInterventionContinuation({
      active: true,
      assistantMessageId: 'msg-continuation',
      continuationOperationId: 'op-continuation',
      reservationId: 'reservation-1',
      sourceOperationId: 'op-source',
      startedAt: '2026-10-01T00:00:00.000Z',
      topicId,
      ...overrides,
    });

  it('reports a conflict for a topic the caller cannot see', async () => {
    await serverDB.insert(topics).values({ id: topicId, metadata: {}, userId: otherUserId });

    expect(await repair({})).toBe('conflict');
    expect(await readMetadata()).toEqual({});
  });

  it('keeps the continuation marker’s own fields when it already owns the topic', async () => {
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: {
        runningOperation: {
          assistantMessageId: 'msg-stale',
          deviceId: 'device-1',
          operationId: 'op-continuation',
        },
      },
      userId,
    });

    expect(await repair({ scope: null, threadId: null })).toBe('repaired');
    expect(await readMetadata()).toEqual({
      runningOperation: {
        assistantMessageId: 'msg-continuation',
        deviceId: 'device-1',
        heteroType: null,
        operationId: 'op-continuation',
        startedAt: '2026-10-01T00:00:00.000Z',
      },
      taskCallbackReservation: null,
    });
  });

  it('releases its own reservation but keeps a foreign marker on conflict', async () => {
    const runningOperation = { assistantMessageId: 'msg-other', operationId: 'op-other' };
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: {
        runningOperation,
        taskCallbackReservation: {
          messageId: 'reservation-1',
          reservedAt: new Date().toISOString(),
        },
      },
      userId,
    });

    expect(await repair({})).toBe('conflict');
    expect(await readMetadata()).toEqual({ runningOperation, taskCallbackReservation: null });
  });

  it('writes nothing on conflict when it holds no reservation', async () => {
    const runningOperation = { assistantMessageId: 'msg-other', operationId: 'op-other' };
    await serverDB.insert(topics).values({ id: topicId, metadata: { runningOperation }, userId });

    expect(await repair({})).toBe('conflict');
    expect(await readMetadata()).toEqual({ runningOperation });
  });

  it('clears the marker for a terminal repair on an idle topic without a reservation', async () => {
    await serverDB.insert(topics).values({ id: topicId, metadata: {}, userId });

    expect(await repair({ active: false })).toBe('terminal');
    expect(await readMetadata()).toEqual({ runningOperation: null, taskCallbackReservation: null });
  });

  it('reports an absent reservation when there is nothing to release', async () => {
    await serverDB.insert(topics).values({ id: topicId, metadata: {}, userId });

    expect(await topicModel.releaseTaskCallbackReservation(topicId, 'reservation-1')).toBe(
      'absent',
    );
    expect(await topicModel.releaseTaskCallbackReservation('missing-topic', 'reservation-1')).toBe(
      'absent',
    );
  });
});

describe('TopicModel scheduled-run guards', () => {
  const rateLimitRun = {
    kind: 'resume_after_rate_limit',
    runAt: '2026-10-01T00:00:00.000Z',
  } as const;

  it('reports a running topic as busy instead of cancelling its continuation', async () => {
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: { scheduledRun: rateLimitRun } as never,
      status: 'running',
      userId,
    });

    expect(await topicModel.cancelRateLimitContinuation(topicId)).toEqual({ status: 'busy' });
    expect(await readStatus()).toBe('running');
    expect((await readMetadata())?.scheduledRun).toEqual(rateLimitRun);
  });

  it('does not arm a schedule on another user’s topic', async () => {
    await serverDB
      .insert(topics)
      .values({ id: otherTopicId, metadata: {}, status: 'active', userId: otherUserId });

    await topicModel.armScheduledRun(otherTopicId, rateLimitRun as never);

    expect(await readStatus(otherTopicId)).toBe('active');
    expect(await readMetadata(otherTopicId)).toEqual({});
  });

  it('will not claim a scheduled topic that carries no scheduled run', async () => {
    await serverDB
      .insert(topics)
      .values({ id: topicId, metadata: {}, status: 'scheduled', userId });

    const claimed = await TopicModel.claimScheduledTopic(serverDB, topicId, {
      claimedAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-01T00:05:00.000Z',
      id: 'claim-1',
    });

    expect(claimed).toBe(false);
    expect(await readMetadata()).toEqual({});
  });

  it('leaves a topic that is no longer scheduled when clearing its run', async () => {
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: { scheduledRun: rateLimitRun } as never,
      status: 'running',
      userId,
    });

    await TopicModel.clearScheduledRun(serverDB, topicId);
    await TopicModel.clearScheduledRun(serverDB, 'missing-topic');

    expect(await readStatus()).toBe('running');
    expect((await readMetadata())?.scheduledRun).toEqual(rateLimitRun);
  });

  it('does not repoint a scheduled topic whose run was already cleared', async () => {
    await serverDB
      .insert(topics)
      .values({ id: topicId, metadata: {}, status: 'scheduled', userId });

    await TopicModel.repointScheduledRunFailedMessage(serverDB, topicId, 'msg-failed', 'claim-1');

    expect(await readMetadata()).toEqual({});
  });
});
