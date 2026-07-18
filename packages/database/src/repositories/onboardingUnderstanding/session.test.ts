import type { OnboardingUnderstandingSession } from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, messages, threads, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { StaleUnderstandingSessionError, UnderstandingSessionRepository } from './session';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-session-user';
const otherUserId = 'understanding-session-other';
const topicId = 'understanding-session-topic';
const repository = new UnderstandingSessionRepository(db, userId);
const testOperationIds = [
  'source-a-operation',
  'source-b-operation',
  'retired-operation',
  'retired-merge-operation',
  'merge-operation',
];

const sourceRun = (id: string, status: 'pending' | 'completed' | 'failed' = 'pending') => ({
  ...(status === 'pending'
    ? {}
    : { assistantMessageId: `${id}-message`, operationId: `${id}-operation` }),
  source: { externalAccountId: `${id}-account`, id, provider: 'github' },
  status,
  threadId: `${id}-thread`,
});

const createSession = (
  id = 'session-current',
  runs: OnboardingUnderstandingSession['runs'] = [sourceRun('source-a')],
): OnboardingUnderstandingSession => ({ id, runs, status: 'pending' });

describe('UnderstandingSessionRepository', () => {
  beforeEach(async () => {
    await db.delete(agentOperations).where(inArray(agentOperations.id, testOperationIds));
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(topics).values({
      id: topicId,
      metadata: {
        onboardingSession: {
          lastActiveAt: '2026-07-15T00:00:00.000Z',
          phase: 'user_identity',
          startedAt: '2026-07-15T00:00:00.000Z',
          version: 7,
        },
        workingDirectory: '/keep',
      },
      userId,
    });
  });

  afterEach(async () => {
    await db.delete(agentOperations).where(inArray(agentOperations.id, testOperationIds));
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  });

  it('installs and updates the active manifest while preserving topic metadata', async () => {
    await repository.install(topicId, createSession());
    const updated = await repository.update(topicId, 'session-current', (session) => ({
      ...session,
      runs: [{ ...session.runs[0], status: 'collecting' }],
    }));
    const [topic] = await db.select().from(topics);

    expect(updated.status).toBe('processing');
    expect(topic.metadata).toMatchObject({
      onboardingSession: { phase: 'user_identity', understanding: updated, version: 7 },
      workingDirectory: '/keep',
    });
  });

  it('returns the installed session for repeated and concurrent install attempts', async () => {
    const first = createSession('session-first');
    const second = createSession('session-second', [sourceRun('source-b')]);

    await expect(repository.install(topicId, first)).resolves.toEqual(first);
    await expect(repository.install(topicId, second)).resolves.toEqual(first);

    const concurrentTopicId = 'understanding-concurrent-topic';
    await db.insert(topics).values({
      id: concurrentTopicId,
      metadata: {
        onboardingSession: {
          lastActiveAt: '2026-07-15T00:00:00.000Z',
          phase: 'user_identity',
          startedAt: '2026-07-15T00:00:00.000Z',
          version: 7,
        },
      },
      userId,
    });

    const installed = await Promise.all([
      repository.install(concurrentTopicId, first),
      repository.install(concurrentTopicId, second),
    ]);
    expect(installed[0]).toEqual(installed[1]);
    await expect(repository.get(concurrentTopicId)).resolves.toEqual(installed[0]);
  });

  it('converges concurrent initial zero-run failed installs', async () => {
    const concurrentTopicId = 'understanding-empty-concurrent-topic';
    await db.insert(topics).values({
      id: concurrentTopicId,
      metadata: {
        onboardingSession: {
          lastActiveAt: '2026-07-15T00:00:00.000Z',
          phase: 'user_identity',
          startedAt: '2026-07-15T00:00:00.000Z',
          version: 7,
        },
      },
      userId,
    });
    const first: OnboardingUnderstandingSession = { id: 'empty-first', runs: [], status: 'failed' };
    const second: OnboardingUnderstandingSession = {
      id: 'empty-second',
      runs: [],
      status: 'failed',
    };

    const installed = await Promise.all([
      repository.install(concurrentTopicId, first),
      repository.install(concurrentTopicId, second),
    ]);

    expect(installed[0]).toEqual(installed[1]);
    await expect(repository.get(concurrentTopicId)).resolves.toEqual(installed[0]);
  });

  it('replaces only an installed zero-run failed session', async () => {
    const failed: OnboardingUnderstandingSession = {
      id: 'session-failed',
      runs: [],
      status: 'failed',
    };
    const replacement = createSession('session-replacement');

    await repository.install(topicId, failed);
    await expect(repository.install(topicId, replacement, failed.id)).resolves.toEqual(replacement);
    await expect(repository.get(topicId)).resolves.toEqual(replacement);
  });

  it('allows only one replacement of the expected zero-run failed session', async () => {
    const failed: OnboardingUnderstandingSession = {
      id: 'session-failed',
      runs: [],
      status: 'failed',
    };
    const first: OnboardingUnderstandingSession = {
      id: 'replacement-first',
      runs: [],
      status: 'failed',
    };
    const second: OnboardingUnderstandingSession = {
      id: 'replacement-second',
      runs: [],
      status: 'failed',
    };
    await repository.install(topicId, failed);

    const installed = await Promise.all([
      repository.install(topicId, first, failed.id),
      repository.install(topicId, second, failed.id),
    ]);

    expect(installed[0]).toEqual(installed[1]);
    expect(installed[0].id).not.toBe(failed.id);
    await expect(repository.get(topicId)).resolves.toEqual(installed[0]);
  });

  it('rejects another user and a stale session', async () => {
    const otherTopicId = 'understanding-other-topic';
    await db.insert(topics).values({ id: otherTopicId, userId: otherUserId });

    await expect(repository.install(otherTopicId, createSession())).rejects.toThrow();
    await repository.install(topicId, createSession());
    await expect(
      repository.update(topicId, 'session-stale', (session) => session),
    ).rejects.toBeInstanceOf(StaleUnderstandingSessionError);
  });

  it('allows exactly one merge claim after source runs become terminal', async () => {
    const runs = [sourceRun('source-a', 'completed'), sourceRun('source-b', 'failed')];
    await repository.install(topicId, createSession('session-current', runs));
    await db.insert(threads).values({
      id: runs[0].threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      status: ThreadStatus.Completed,
      topicId,
      type: ThreadType.Isolation,
      userId,
    });

    const claims = await Promise.all([
      repository.claimMerge(topicId, 'session-current', 'merge-thread-a'),
      repository.claimMerge(topicId, 'session-current', 'merge-thread-b'),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await repository.get(topicId))?.mergeRun).toMatchObject({
      inputThreadIds: [runs[0].threadId],
      status: 'pending',
    });
  });

  it('does not claim a merge when every source failed', async () => {
    await repository.install(
      topicId,
      createSession('session-current', [sourceRun('source-a', 'failed')]),
    );

    await expect(repository.claimMerge(topicId, 'session-current', 'merge-thread')).resolves.toBe(
      false,
    );
  });

  it('removes the manifest and only its referenced hidden threads for onboarding reset', async () => {
    const runs = [sourceRun('source-a', 'completed'), sourceRun('source-b', 'failed')];
    const retiredRun = {
      ...sourceRun('source-a', 'failed'),
      assistantMessageId: 'retired-message',
      operationId: 'retired-operation',
      threadId: 'retired-thread',
    };
    const retiredMergeRun = {
      assistantMessageId: 'retired-merge-message',
      inputThreadIds: [retiredRun.threadId],
      operationId: 'retired-merge-operation',
      status: 'failed' as const,
      threadId: 'retired-merge-thread',
    };
    const understandingSession: OnboardingUnderstandingSession = {
      ...createSession('session-current', runs),
      mergeRun: {
        assistantMessageId: 'merge-message',
        inputThreadIds: [runs[0].threadId],
        operationId: 'merge-operation',
        status: 'processing',
        threadId: 'merge-thread',
      },
      retiredMergeRuns: [retiredMergeRun],
      retiredRuns: [retiredRun],
      status: 'processing',
    };
    const installedSession = await repository.install(topicId, understandingSession);
    await db.insert(threads).values([
      ...runs.map((run) => ({
        id: run.threadId,
        metadata: { onboardingUnderstanding: { kind: 'source' as const } },
        status: ThreadStatus.Pending,
        topicId,
        type: ThreadType.Isolation,
        userId,
      })),
      {
        id: retiredRun.threadId,
        metadata: { onboardingUnderstanding: { kind: 'source' as const } },
        status: ThreadStatus.Completed,
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
      {
        id: retiredMergeRun.threadId,
        metadata: { onboardingUnderstanding: { kind: 'merged' as const } },
        status: ThreadStatus.Completed,
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
      {
        id: 'merge-thread',
        metadata: { onboardingUnderstanding: { kind: 'merged' as const } },
        status: ThreadStatus.Pending,
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
      {
        id: 'ordinary-thread',
        status: ThreadStatus.Active,
        topicId,
        type: ThreadType.Continuation,
        userId,
      },
    ]);
    await db.insert(messages).values([
      {
        content: 'hidden',
        id: 'source-message',
        role: 'assistant',
        threadId: runs[0].threadId,
        topicId,
        userId,
      },
      {
        content: 'keep',
        id: 'ordinary-message',
        role: 'user',
        threadId: 'ordinary-thread',
        topicId,
        userId,
      },
    ]);
    await db.insert(agentOperations).values([
      {
        id: retiredRun.operationId,
        status: 'error',
        threadId: retiredRun.threadId,
        topicId,
        userId,
      },
      {
        id: retiredMergeRun.operationId,
        status: 'error',
        threadId: retiredMergeRun.threadId,
        topicId,
        userId,
      },
      {
        id: runs[0].operationId!,
        status: 'done',
        threadId: runs[0].threadId,
        topicId,
        userId,
      },
      {
        id: understandingSession.mergeRun!.operationId!,
        status: 'running',
        threadId: understandingSession.mergeRun!.threadId,
        topicId,
        userId,
      },
    ]);

    await expect(repository.removeForReset(topicId)).resolves.toEqual({
      operationIds: [
        retiredRun.operationId,
        runs[0].operationId,
        retiredMergeRun.operationId,
        understandingSession.mergeRun?.operationId,
      ],
      session: installedSession,
    });

    expect(await repository.get(topicId)).toBeUndefined();
    expect((await db.select().from(topics)).map(({ id }) => id)).toContain(topicId);
    expect((await db.select().from(threads)).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['ordinary-thread']),
    );
    expect(await db.select().from(threads)).toHaveLength(1);
    expect((await db.select().from(messages)).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['ordinary-message']),
    );
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it('rejects reset cleanup when a referenced thread has the wrong marker', async () => {
    const understandingSession = createSession();
    await repository.install(topicId, understandingSession);
    await db.insert(threads).values({
      id: understandingSession.runs[0].threadId,
      metadata: { onboardingUnderstanding: { kind: 'merged' } },
      status: ThreadStatus.Pending,
      topicId,
      type: ThreadType.Isolation,
      userId,
    });

    await expect(repository.removeForReset(topicId)).rejects.toThrow();
    await expect(repository.get(topicId)).resolves.toEqual(understandingSession);
    expect(await db.select().from(threads)).toHaveLength(1);
  });

  it('rejects reset cleanup when a referenced thread is not owned by the caller', async () => {
    const understandingSession = createSession();
    await repository.install(topicId, understandingSession);
    await db.insert(threads).values({
      id: understandingSession.runs[0].threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      status: ThreadStatus.Pending,
      topicId,
      type: ThreadType.Isolation,
      userId: otherUserId,
    });

    await expect(repository.removeForReset(topicId)).rejects.toThrow();
    await expect(repository.get(topicId)).resolves.toEqual(understandingSession);
    expect(await db.select().from(threads)).toHaveLength(1);
  });

  it('rejects reset cleanup when a referenced operation is owned by another user', async () => {
    const understandingSession = createSession('session-current', [
      sourceRun('source-a', 'completed'),
    ]);
    const installedSession = await repository.install(topicId, understandingSession);
    await db.insert(threads).values({
      id: understandingSession.runs[0].threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      status: ThreadStatus.Completed,
      topicId,
      type: ThreadType.Isolation,
      userId,
    });
    await db.insert(agentOperations).values({
      id: understandingSession.runs[0].operationId!,
      status: 'done',
      threadId: understandingSession.runs[0].threadId,
      topicId,
      userId: otherUserId,
    });

    await expect(repository.removeForReset(topicId)).rejects.toThrow();
    await expect(repository.get(topicId)).resolves.toEqual(installedSession);
    expect(await db.select().from(threads)).toHaveLength(1);
  });

  it('rejects reset cleanup when an operation points to a different thread', async () => {
    const understandingSession = createSession('session-current', [
      sourceRun('source-a', 'completed'),
    ]);
    const installedSession = await repository.install(topicId, understandingSession);
    await db.insert(threads).values([
      {
        id: understandingSession.runs[0].threadId,
        metadata: { onboardingUnderstanding: { kind: 'source' } },
        status: ThreadStatus.Completed,
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
      {
        id: 'different-thread',
        status: ThreadStatus.Active,
        topicId,
        type: ThreadType.Continuation,
        userId,
      },
    ]);
    await db.insert(agentOperations).values({
      id: understandingSession.runs[0].operationId!,
      status: 'done',
      threadId: 'different-thread',
      topicId,
      userId,
    });

    await expect(repository.removeForReset(topicId)).rejects.toThrow();
    await expect(repository.get(topicId)).resolves.toEqual(installedSession);
    expect(await db.select().from(threads)).toHaveLength(2);
  });
});
