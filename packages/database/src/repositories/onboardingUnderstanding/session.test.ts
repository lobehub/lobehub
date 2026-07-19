import type { OnboardingUnderstandingSession } from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, threads, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { StaleUnderstandingSessionError, UnderstandingSessionRepository } from './session';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-session-user';
const otherUserId = 'understanding-session-other';
const topicId = 'understanding-session-topic';
const repository = new UnderstandingSessionRepository(db, userId);

const sourceRun = (
  id: string,
  status: 'pending' | 'running' | 'completed' | 'failed' = 'pending',
) => ({
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
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  });

  it('installs and mutates the active session while preserving topic metadata', async () => {
    await repository.install(topicId, createSession());
    const updated = await repository.update(topicId, 'session-current', (session) => ({
      ...session,
      runs: [{ ...session.runs[0], status: 'running' }],
    }));
    const [topic] = await db.select().from(topics);

    expect(updated.status).toBe('processing');
    expect(topic.metadata).toMatchObject({
      onboardingSession: { phase: 'user_identity', understanding: updated, version: 7 },
      workingDirectory: '/keep',
    });
  });

  it('converges repeated and concurrent install attempts', async () => {
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
    const first = createSession('session-first');
    const second = createSession('session-second', [sourceRun('source-b')]);

    const installed = await Promise.all([
      repository.install(concurrentTopicId, first),
      repository.install(concurrentTopicId, second),
    ]);

    expect(installed[0]).toEqual(installed[1]);
    await expect(repository.get(concurrentTopicId)).resolves.toEqual(installed[0]);
  });

  it('rejects another user and stale session mutations', async () => {
    const otherTopicId = 'understanding-other-topic';
    await db.insert(topics).values({ id: otherTopicId, userId: otherUserId });

    await expect(repository.install(otherTopicId, createSession())).rejects.toThrow();
    await repository.install(topicId, createSession());
    await expect(
      repository.update(topicId, 'session-stale', (session) => session),
    ).rejects.toBeInstanceOf(StaleUnderstandingSessionError);
  });

  it('attaches the latest workflow run', async () => {
    await repository.install(topicId, createSession());

    await expect(
      repository.attachWorkflowRun(topicId, 'session-current', 'workflow-run-1'),
    ).resolves.toMatchObject({ workflowRunId: 'workflow-run-1' });
    await expect(
      repository.attachWorkflowRun(topicId, 'session-current', 'workflow-run-2'),
    ).resolves.toMatchObject({ workflowRunId: 'workflow-run-2' });
  });

  it('updates source and merge state through focused methods', async () => {
    await repository.install(topicId, createSession());

    const sourceUpdated = await repository.updateSourceRun(topicId, 'session-current', 'source-a', {
      assistantMessageId: 'source-message',
      diagnostics: { evidenceCount: 4, failedCount: 1, succeededCount: 3 },
      resultId: 'source-result',
      status: 'completed',
    });
    expect(sourceUpdated.runs[0]).toMatchObject({
      assistantMessageId: 'source-message',
      resultId: 'source-result',
      status: 'completed',
    });

    await repository.setMergeRun(topicId, 'session-current', {
      status: 'pending',
      threadId: 'merge-thread',
    });
    const mergeUpdated = await repository.updateMergeRun(topicId, 'session-current', {
      assistantMessageId: 'merge-message',
      resultId: 'merge-result',
      status: 'completed',
    });
    expect(mergeUpdated).toMatchObject({
      mergeRun: {
        assistantMessageId: 'merge-message',
        resultId: 'merge-result',
        status: 'completed',
      },
      status: 'completed',
    });
  });

  it('rejects updates for an unknown source or missing merge run', async () => {
    await repository.install(topicId, createSession());

    await expect(
      repository.updateSourceRun(topicId, 'session-current', 'missing', { status: 'failed' }),
    ).rejects.toThrow('source was not found');
    await expect(
      repository.updateMergeRun(topicId, 'session-current', { status: 'failed' }),
    ).rejects.toThrow('merge run was not found');
  });

  it('removes the session and its referenced hidden threads for onboarding reset', async () => {
    const session: OnboardingUnderstandingSession = {
      ...createSession('session-current', [sourceRun('source-a', 'completed')]),
      mergeRun: {
        status: 'completed',
        threadId: 'merge-thread',
      },
      status: 'completed',
    };
    await repository.install(topicId, session);
    await db.insert(threads).values([
      {
        id: 'source-a-thread',
        metadata: { onboardingUnderstanding: { kind: 'source' as const } },
        status: ThreadStatus.Completed,
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
      {
        id: 'merge-thread',
        metadata: { onboardingUnderstanding: { kind: 'merged' as const } },
        status: ThreadStatus.Completed,
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
        threadId: 'source-a-thread',
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

    await expect(repository.removeForReset(topicId)).resolves.toEqual(session);
    await expect(repository.get(topicId)).resolves.toBeUndefined();
    expect((await db.select().from(threads)).map(({ id }) => id)).toEqual(['ordinary-thread']);
    expect((await db.select().from(messages)).map(({ id }) => id)).toEqual(['ordinary-message']);
  });
});
