import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-update-user';
const sessionId = 'topic-update-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

/**
 * Seed the `agent_operations` row a `runningOperation` marker points at — the
 * authority `tryReserveTaskCallback` consults to decide whether the run still
 * owns the topic. `topicId` is deliberately left unset: the liveness lookup is
 * by operation id, and setting it would require the topic row to exist first.
 */
const seedOperation = async ({
  createdAt,
  id,
  status,
}: {
  createdAt?: Date;
  id: string;
  status: 'done' | 'error' | 'idle' | 'running' | 'waiting_for_async_tool' | 'waiting_for_human';
}) => {
  await serverDB.insert(agentOperations).values({
    id,
    status,
    userId,
    ...(createdAt ? { createdAt } : {}),
  });
};

describe('TopicModel - Update', () => {
  beforeEach(async () => {
    await serverDB.delete(agentOperations);
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('update', () => {
    it('should update a topic', async () => {
      const topicId = '123';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test', favorite: true });

      const item = await topicModel.update(topicId, {
        title: 'Updated Test',
        favorite: false,
      });

      expect(item).toHaveLength(1);
      expect(item[0].title).toBe('Updated Test');
      expect(item[0].favorite).toBeFalsy();
    });

    it('should not update a topic if user ID does not match', async () => {
      await serverDB.insert(users).values([{ id: '456' }]);
      const topicId = '123';
      await serverDB
        .insert(topics)
        .values({ userId: '456', id: topicId, title: 'Test', favorite: true });

      const item = await topicModel.update(topicId, {
        title: 'Updated Test Session',
      });

      expect(item).toHaveLength(0);
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata on a topic with no existing metadata', async () => {
      const topicId = 'metadata-test-1';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test' });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/path/to/dir',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({ workingDirectory: '/path/to/dir' });
    });

    it('should merge metadata with existing metadata', async () => {
      const topicId = 'metadata-test-2';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: { model: 'gpt-4', provider: 'openai' },
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/new/path',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        workingDirectory: '/new/path',
      });
    });

    it('should overwrite existing metadata fields when updating', async () => {
      const topicId = 'metadata-test-3';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: { workingDirectory: '/old/path', model: 'gpt-4' },
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/new/path',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({
        model: 'gpt-4',
        workingDirectory: '/new/path',
      });
    });

    it('should not update metadata if user ID does not match', async () => {
      await serverDB.insert(users).values([{ id: 'other-user' }]);
      const topicId = 'metadata-test-4';
      await serverDB.insert(topics).values({
        userId: 'other-user',
        id: topicId,
        title: 'Test',
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/path/to/dir',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('task callback reservation', () => {
    it('reserves only an idle topic and releases only the matching owner', async () => {
      const topicId = 'task-callback-reservation';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test' });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-1')).resolves.toBe(true);
      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-2')).resolves.toBe(false);

      await topicModel.releaseTaskCallbackReservation(topicId, 'callback-2');
      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-2')).resolves.toBe(false);

      await topicModel.releaseTaskCallbackReservation(topicId, 'callback-1');
      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-2')).resolves.toBe(true);
    });

    it('allows the reservation owner to re-enter the same topic-start claim', async () => {
      const topicId = 'topic-start-reentrant-reservation';
      await serverDB.insert(topics).values({ id: topicId, title: 'Test', userId });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'foreground-1')).resolves.toBe(true);
      await expect(topicModel.tryReserveTaskCallback(topicId, 'foreground-1')).resolves.toBe(true);
      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-2')).resolves.toBe(false);
    });

    it('fences a concurrent deterministic intervention initializer with the same id', async () => {
      const topicId = 'topic-start-non-reentrant-intervention';
      await serverDB.insert(topics).values({ id: topicId, title: 'Test', userId });

      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'op-intervention', {
          allowSameReservationReentry: false,
          ignoreRunningOperation: true,
        }),
      ).resolves.toBe(true);
      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'op-intervention', {
          allowSameReservationReentry: false,
          ignoreRunningOperation: true,
        }),
      ).resolves.toBe(false);
    });

    it('grants exactly one non-reentrant initializer under a real concurrent row lock', async () => {
      const topicId = 'topic-start-concurrent-non-reentrant-intervention';
      await serverDB.insert(topics).values({ id: topicId, title: 'Test', userId });

      const results = await Promise.all([
        topicModel.tryReserveTaskCallback(topicId, 'op-intervention', {
          allowSameReservationReentry: false,
          ignoreRunningOperation: true,
        }),
        topicModel.tryReserveTaskCallback(topicId, 'op-intervention', {
          allowSameReservationReentry: false,
          ignoreRunningOperation: true,
        }),
      ]);

      expect(results.sort()).toEqual([false, true]);
    });

    it('waits while a foreground operation is running', async () => {
      const topicId = 'task-callback-running-operation';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'operation-1',
            startedAt: new Date().toISOString(),
          },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-1')).resolves.toBe(false);

      await topicModel.updateMetadata(topicId, { runningOperation: null });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-1')).resolves.toBe(true);
    });

    it('atomically hands a topic from the matching visible-finished operation to a new start', async () => {
      const topicId = 'topic-start-operation-handoff';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'old-operation',
            startedAt: new Date().toISOString(),
          },
        },
      });

      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'new-start', {
          replacesOperationId: 'different-operation',
        }),
      ).resolves.toBe(false);
      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'new-start', {
          replacesOperationId: 'old-operation',
        }),
      ).resolves.toBe(true);

      const topic = await serverDB.query.topics.findFirst({ where: eq(topics.id, topicId) });
      expect(topic?.metadata?.runningOperation).toBeNull();
      expect(topic?.metadata?.taskCallbackReservation?.messageId).toBe('new-start');
    });

    it('allows a child operation to re-enter its parent running operation', async () => {
      const topicId = 'task-callback-parent-operation';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-parent',
            operationId: 'operation-parent',
          },
        },
      });

      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'child-operation-1', {
          allowRunningOperationId: 'operation-parent',
        }),
      ).resolves.toBe(true);
      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'child-operation-2', {
          allowRunningOperationId: 'operation-parent',
        }),
      ).resolves.toBe(true);
      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'unrelated-operation', {
          allowRunningOperationId: 'operation-other',
        }),
      ).resolves.toBe(false);

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.taskCallbackReservation).toBeUndefined();
      expect(topic?.metadata?.runningOperation?.operationId).toBe('operation-parent');
    });

    it('atomically appends children to the parent running operation', async () => {
      const topicId = 'task-callback-parent-operation-children';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-parent',
            operationId: 'parent-operation',
          },
        },
      });

      await Promise.all([
        topicModel.appendRunningOperationChild(topicId, 'parent-operation', {
          assistantMessageId: 'assistant-child-1',
          operationId: 'child-operation-1',
        }),
        topicModel.appendRunningOperationChild(topicId, 'parent-operation', {
          assistantMessageId: 'assistant-child-2',
          operationId: 'child-operation-2',
        }),
      ]);

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation?.childOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationId: 'child-operation-1' }),
          expect.objectContaining({ operationId: 'child-operation-2' }),
        ]),
      );
    });

    it('atomically takes a child running operation once', async () => {
      const topicId = 'task-callback-take-child-operation';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-parent',
            childOperations: [
              { assistantMessageId: 'assistant-child', operationId: 'child-operation' },
            ],
            operationId: 'parent-operation',
          },
        },
      });

      const claims = await Promise.all([
        topicModel.takeRunningOperation(topicId, 'child-operation'),
        topicModel.takeRunningOperation(topicId, 'child-operation'),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)).toMatchObject({
        isRoot: false,
        operation: { operationId: 'child-operation' },
      });
      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation).toMatchObject({ operationId: 'parent-operation' });
      expect(topic?.metadata?.runningOperation?.childOperations).toEqual([]);
    });

    it('updates only the matching child assistant message pointer', async () => {
      const topicId = 'task-callback-update-child-message';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-parent',
            childOperations: [
              { assistantMessageId: 'assistant-child-1', operationId: 'child-operation-1' },
              { assistantMessageId: 'assistant-child-2', operationId: 'child-operation-2' },
            ],
            operationId: 'parent-operation',
          },
        },
        title: 'Test',
        userId,
      });

      await expect(
        topicModel.updateRunningOperationAssistantMessage(
          topicId,
          'child-operation-1',
          'assistant-child-1-next',
        ),
      ).resolves.toBe(true);

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation).toMatchObject({
        assistantMessageId: 'assistant-parent',
        childOperations: [
          { assistantMessageId: 'assistant-child-1-next', operationId: 'child-operation-1' },
          { assistantMessageId: 'assistant-child-2', operationId: 'child-operation-2' },
        ],
      });
      expect(topic?.metadata?.heteroCurrentMsgId).toEqual({
        msgId: 'assistant-child-1-next',
        operationId: 'child-operation-1',
      });
    });

    it('recovers a topic whose runningOperation already reached a terminal state', async () => {
      // Regression: `taskCallbackReservation` expires after a TTL, but
      // `runningOperation` was checked bare. Every clear site is best-effort
      // (ServerOperationStore.clearRunningMark swallows failures; the gateway
      // client clears it from `onSessionComplete`, which never runs if the tab
      // closed or the function was killed), so a marker left behind by a
      // finished run blocked every later start on that topic — permanently,
      // since nothing sweeps it.
      const topicId = 'topic-start-terminal-running-operation';
      await seedOperation({ id: 'finished-operation', status: 'error' });
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'finished-operation',
          },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'later-start')).resolves.toBe(true);
    });

    it('recovers a topic whose runningOperation row no longer exists and carries no stamp', async () => {
      // A marker with neither an operation row nor a `startedAt` cannot be
      // proven live; holding the topic on it keeps an already-stuck
      // conversation stuck forever.
      const topicId = 'topic-start-orphan-running-operation';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: { assistantMessageId: 'assistant-1', operationId: 'no-such-operation' },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'later-start')).resolves.toBe(true);
    });

    it('keeps holding the topic for a run parked on a human, however long it waits', async () => {
      // `startedAt` is never refreshed, so an age-based check declared any run
      // older than the TTL dead and let a callback start a competing
      // continuation. An approval wait legitimately lasts days.
      const topicId = 'topic-start-long-approval-wait';
      await seedOperation({
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        id: 'parked-operation',
        status: 'waiting_for_human',
      });
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'parked-operation',
            startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-1')).resolves.toBe(false);
    });

    it('keeps holding the topic for a live run whose marker predates the stamp', async () => {
      // Rolling deployment: an older server instance writes `runningOperation`
      // without `startedAt`. Treating unstamped markers as dead would let a new
      // instance start a competing run against a live one.
      const topicId = 'topic-start-unstamped-live-operation';
      await seedOperation({ id: 'old-instance-operation', status: 'running' });
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'old-instance-operation',
          },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-1')).resolves.toBe(false);
    });

    it('ages out a run that still claims running long after its process died', async () => {
      // A killed process never writes a terminal status, so status alone would
      // hold the topic forever. Only non-parked states are aged out.
      const topicId = 'topic-start-abandoned-running-operation';
      await seedOperation({
        createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        id: 'abandoned-operation',
        status: 'running',
      });
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'abandoned-operation',
          },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'later-start')).resolves.toBe(true);
    });

    it('lets an interactive start through while a run still owns the topic', async () => {
      // "One foreground turn at a time" is a client-side UX policy with a queue
      // tray and a Send-now escape hatch. Re-deciding it here can only fail
      // worse: the gate runs before the user message is persisted, so a refusal
      // destroys the message instead of parking it.
      const topicId = 'topic-start-interactive-bypass';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'live-operation',
            startedAt: new Date().toISOString(),
          },
        },
      });

      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'composer-send', {
          ignoreRunningOperation: true,
        }),
      ).resolves.toBe(true);

      // A background delivery arriving at the same topic still waits.
      await topicModel.releaseTaskCallbackReservation(topicId, 'composer-send');
      await expect(topicModel.tryReserveTaskCallback(topicId, 'callback-1')).resolves.toBe(false);
    });

    it('still serializes an interactive start behind the short reservation', async () => {
      // Bypassing `runningOperation` must not bypass the mutex that makes parent
      // selection atomic — two sends landing together would otherwise both pick
      // the same parent and fork the spine.
      const topicId = 'topic-start-interactive-reservation';
      await serverDB.insert(topics).values({ id: topicId, title: 'Test', userId });

      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'send-1', { ignoreRunningOperation: true }),
      ).resolves.toBe(true);
      await expect(
        topicModel.tryReserveTaskCallback(topicId, 'send-2', { ignoreRunningOperation: true }),
      ).resolves.toBe(false);
    });

    it('recovers a stale reservation left by a crashed delivery worker', async () => {
      const topicId = 'task-callback-stale-reservation';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: {
          taskCallbackReservation: {
            messageId: 'crashed-callback',
            reservedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          },
        },
      });

      await expect(topicModel.tryReserveTaskCallback(topicId, 'retry-callback')).resolves.toBe(
        true,
      );
    });

    it('repairs the exact intervention continuation anchor after queue ACK', async () => {
      const topicId = 'intervention-anchor-repair';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-source',
            operationId: 'operation-source',
          },
          taskCallbackReservation: {
            messageId: 'operation-continuation',
            reservedAt: new Date().toISOString(),
          },
        },
        title: 'Test',
        userId,
      });

      await expect(
        topicModel.repairAgentInterventionContinuation({
          active: true,
          assistantMessageId: 'assistant-continuation',
          continuationOperationId: 'operation-continuation',
          reservationId: 'operation-continuation',
          scope: 'main',
          sourceOperationId: 'operation-source',
          startedAt: '2026-08-26T00:00:00.000Z',
          topicId,
        }),
      ).resolves.toBe('repaired');

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation).toMatchObject({
        assistantMessageId: 'assistant-continuation',
        heteroType: null,
        operationId: 'operation-continuation',
        scope: 'main',
      });
      expect(topic?.metadata?.taskCallbackReservation).toBeNull();
    });

    it('releases an exact thread fence without changing the main running anchor', async () => {
      const topicId = 'intervention-thread-reservation-release';
      const mainRunningOperation = {
        assistantMessageId: 'assistant-main',
        operationId: 'operation-main',
        scope: 'main',
        startedAt: '2026-08-26T00:00:00.000Z',
      };
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: mainRunningOperation,
          taskCallbackReservation: {
            messageId: 'operation-thread-continuation',
            reservedAt: new Date().toISOString(),
          },
        },
        title: 'Test',
        userId,
      });

      await expect(
        topicModel.releaseTaskCallbackReservation(topicId, 'operation-thread-continuation'),
      ).resolves.toBe('released');

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation).toEqual(mainRunningOperation);
      expect(topic?.metadata?.taskCallbackReservation).toBeNull();
    });

    it('does not release a foreign thread fence or change the main running anchor', async () => {
      const topicId = 'intervention-thread-foreign-reservation';
      const mainRunningOperation = {
        assistantMessageId: 'assistant-main',
        operationId: 'operation-main',
      };
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: mainRunningOperation,
          taskCallbackReservation: {
            messageId: 'foreign-operation',
            reservedAt: new Date().toISOString(),
          },
        },
        title: 'Test',
        userId,
      });

      await expect(
        topicModel.releaseTaskCallbackReservation(topicId, 'operation-thread-continuation'),
      ).resolves.toBe('foreign');

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation).toEqual(mainRunningOperation);
      expect(topic?.metadata?.taskCallbackReservation?.messageId).toBe('foreign-operation');
    });

    it('does not repair across a foreign live topic reservation', async () => {
      const topicId = 'intervention-anchor-foreign-reservation';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-source',
            operationId: 'operation-source',
          },
          taskCallbackReservation: {
            messageId: 'foreign-operation',
            reservedAt: new Date().toISOString(),
          },
        },
        title: 'Test',
        userId,
      });

      await expect(
        topicModel.repairAgentInterventionContinuation({
          active: true,
          assistantMessageId: 'assistant-continuation',
          continuationOperationId: 'operation-continuation',
          reservationId: 'operation-continuation',
          sourceOperationId: 'operation-source',
          startedAt: '2026-08-26T00:00:00.000Z',
          topicId,
        }),
      ).resolves.toBe('conflict');

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation?.operationId).toBe('operation-source');
      expect(topic?.metadata?.taskCallbackReservation?.messageId).toBe('foreign-operation');
    });

    it('clears a terminal intervention anchor without reactivating it', async () => {
      const topicId = 'intervention-anchor-terminal';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-source',
            operationId: 'operation-source',
          },
          taskCallbackReservation: {
            messageId: 'operation-continuation',
            reservedAt: new Date().toISOString(),
          },
        },
        title: 'Test',
        userId,
      });

      await expect(
        topicModel.repairAgentInterventionContinuation({
          active: false,
          assistantMessageId: 'assistant-continuation',
          continuationOperationId: 'operation-continuation',
          reservationId: 'operation-continuation',
          sourceOperationId: 'operation-source',
          startedAt: '2026-08-26T00:00:00.000Z',
          topicId,
        }),
      ).resolves.toBe('terminal');

      const topic = await topicModel.findById(topicId);
      expect(topic?.metadata?.runningOperation).toBeNull();
      expect(topic?.metadata?.taskCallbackReservation).toBeNull();
    });

    it('does not reserve another user topic', async () => {
      await serverDB.insert(users).values({ id: 'task-callback-other-user' });
      await serverDB.insert(topics).values({
        userId: 'task-callback-other-user',
        id: 'task-callback-other-topic',
        title: 'Test',
      });

      await expect(
        topicModel.tryReserveTaskCallback('task-callback-other-topic', 'callback-1'),
      ).resolves.toBeNull();
    });
  });

  describe('recomputeUsage', () => {
    it('rolls the topic assistant messages into the denormalized usage/cost columns', async () => {
      const topicId = 'usage-recompute-1';
      // Seed a pinned model (config). The roll-up must preserve it, not overwrite
      // it with the message's model — those columns hold the topic's config, not
      // the measured dominant model (which lives in cost.llm.byModel).
      await serverDB.insert(topics).values({
        id: topicId,
        model: 'pinned-model',
        provider: 'pinned-provider',
        sessionId,
        userId,
      });
      await serverDB.insert(messages).values([
        {
          id: 'usage-msg-1',
          metadata: {
            performance: { duration: 500 },
            usage: { cost: 0.003, totalInputTokens: 60, totalOutputTokens: 40, totalTokens: 100 },
          },
          model: 'gpt-4o',
          provider: 'openai',
          role: 'assistant',
          topicId,
          userId,
        },
        // a non-usage message must be ignored
        { id: 'usage-msg-2', content: 'hi', role: 'user', topicId, userId },
      ]);

      await topicModel.recomputeUsage(topicId);

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(topic.totalTokens).toBe(100);
      expect(topic.totalInputTokens).toBe(60);
      expect(topic.totalOutputTokens).toBe(40);
      expect(topic.totalCost).toBeCloseTo(0.003, 6);
      // Pinned model (config) is preserved — roll-up does not write the message model.
      expect(topic.model).toBe('pinned-model');
      expect(topic.provider).toBe('pinned-provider');
      expect((topic.usage as any).llm).toEqual({
        apiCalls: 1,
        processingTimeMs: 500,
        tokens: { input: 60, output: 40, total: 100 },
      });
    });

    it('resets the usage columns to NULL when the topic has no measurable usage', async () => {
      const topicId = 'usage-recompute-2';
      await serverDB.insert(topics).values({
        id: topicId,
        sessionId,
        totalCost: 1.23,
        totalTokens: 999,
        userId,
      });

      await topicModel.recomputeUsage(topicId);

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(topic.totalTokens).toBeNull();
      expect(topic.totalCost).toBeNull();
      expect(topic.usage).toBeNull();
      expect(topic.cost).toBeNull();
    });
  });
});
