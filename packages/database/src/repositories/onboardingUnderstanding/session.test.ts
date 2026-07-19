import type { CollectionError, OnboardingUnderstandingSession } from '@lobechat/types';
import { MAX_COLLECTION_ERRORS, ThreadStatus, ThreadType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, threads, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  StaleUnderstandingRunError,
  StaleUnderstandingSessionError,
  UnderstandingSessionRepository,
} from './session';

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

  it('atomically terminalizes exhausted workflow work with a bounded retryable error', async () => {
    const previousError: CollectionError = {
      code: 'PREVIOUS_ERROR',
      message: 'Previous error',
      operation: 'collection',
      provider: 'github',
      retryable: false,
    };
    await repository.install(topicId, {
      ...createSession('session-current', [
        sourceRun('github', 'completed'),
        sourceRun('gmail', 'running'),
      ]),
      errors: Array.from({ length: MAX_COLLECTION_ERRORS }, () => previousError),
      status: 'processing',
    });
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-current');
    const workflowError: CollectionError = {
      code: 'UNDERSTANDING_WORKFLOW_FAILED',
      message: 'Onboarding understanding workflow failed',
      operation: 'workflow',
      provider: 'understanding',
      retryable: true,
    };

    const terminal = await repository.terminalizeWorkflow(
      topicId,
      'session-current',
      'workflow-current',
      'merge-session-current',
      workflowError,
    );

    expect(terminal).toMatchObject({
      mergeRun: { status: 'failed', threadId: 'merge-session-current' },
      status: 'failed',
    });
    expect(terminal.runs.map(({ status }) => status)).toEqual(['completed', 'failed']);
    expect(terminal.errors).toHaveLength(MAX_COLLECTION_ERRORS);
    expect(terminal.errors?.at(-1)).toEqual(workflowError);
  });

  it('ignores an exhausted callback from a stale workflow run', async () => {
    await repository.install(topicId, createSession());
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-current');

    const unchanged = await repository.terminalizeWorkflow(
      topicId,
      'session-current',
      'workflow-stale',
      'merge-session-current',
      {
        code: 'UNDERSTANDING_WORKFLOW_FAILED',
        message: 'Onboarding understanding workflow failed',
        operation: 'workflow',
        provider: 'understanding',
        retryable: true,
      },
    );

    expect(unchanged).toEqual(await repository.get(topicId));
    expect(unchanged).toMatchObject({
      runs: [{ status: 'pending' }],
      status: 'pending',
      workflowRunId: 'workflow-current',
    });
    expect(unchanged.errors).toBeUndefined();
  });

  it('updates source state through its focused method', async () => {
    await repository.install(topicId, createSession());
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-run');

    const sourceUpdated = await repository.updateSourceRun(
      topicId,
      'session-current',
      'source-a',
      'source-a-thread',
      {
        assistantMessageId: 'source-message',
        diagnostics: { evidenceCount: 4, failedCount: 1, succeededCount: 3 },
        resultId: 'source-result',
        status: 'completed',
      },
    );
    expect(sourceUpdated.runs[0]).toMatchObject({
      assistantMessageId: 'source-message',
      resultId: 'source-result',
      status: 'completed',
    });
  });

  it('rejects updates for an unknown source', async () => {
    await repository.install(topicId, createSession());
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-run');

    await expect(
      repository.updateSourceRun(topicId, 'session-current', 'missing', 'missing-thread', {
        status: 'failed',
      }),
    ).rejects.toThrow('source was not found');
  });

  it('allows an older workflow to finish unchanged runs but rejects a replaced source run', async () => {
    await repository.install(
      topicId,
      createSession('session-current', [sourceRun('github'), sourceRun('gmail')]),
    );
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-old');
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-current');

    await expect(
      repository.updateSourceRun(topicId, 'session-current', 'gmail', 'gmail-thread', {
        status: 'completed',
      }),
    ).resolves.toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ id: 'gmail' }),
          status: 'completed',
        }),
      ]),
      workflowRunId: 'workflow-current',
    });

    await repository.update(topicId, 'session-current', (session) => ({
      ...session,
      runs: session.runs.map((run) =>
        run.source.id === 'github' ? { ...run, threadId: 'github-retry-thread' } : run,
      ),
    }));

    await expect(
      repository.updateSourceRun(topicId, 'session-current', 'github', 'github-thread', {
        status: 'completed',
      }),
    ).rejects.toBeInstanceOf(StaleUnderstandingRunError);
  });

  it('creates a merge run idempotently and rejects a different merge identity', async () => {
    await repository.install(topicId, createSession());
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-run');
    const mergeRun = { status: 'pending' as const, threadId: 'merge-thread' };

    const created = await repository.setMergeRun(
      topicId,
      'session-current',
      'workflow-run',
      mergeRun,
    );
    await expect(
      repository.setMergeRun(topicId, 'session-current', 'workflow-run', {
        status: 'running',
        threadId: mergeRun.threadId,
      }),
    ).resolves.toEqual(created);
    await expect(
      repository.setMergeRun(topicId, 'session-current', 'workflow-run', {
        status: 'pending',
        threadId: 'different-merge-thread',
      }),
    ).resolves.toEqual(created);
  });

  it('rejects merge creation from a workflow replaced by a newer retry', async () => {
    await repository.install(topicId, createSession());
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-a');
    await repository.attachWorkflowRun(topicId, 'session-current', 'workflow-b');

    await expect(
      repository.setMergeRun(topicId, 'session-current', 'workflow-a', {
        status: 'pending',
        threadId: 'merge-a',
      }),
    ).rejects.toBeInstanceOf(StaleUnderstandingSessionError);
    await expect(
      repository.setMergeRun(topicId, 'session-current', 'workflow-b', {
        status: 'pending',
        threadId: 'merge-b',
      }),
    ).resolves.toMatchObject({ mergeRun: { threadId: 'merge-b' } });
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

  it('rejects reset when a referenced thread has the wrong marker', async () => {
    const session = createSession();
    await repository.install(topicId, session);
    await db.insert(threads).values({
      id: session.runs[0].threadId,
      metadata: { onboardingUnderstanding: { kind: 'merged' } },
      status: ThreadStatus.Pending,
      topicId,
      type: ThreadType.Isolation,
      userId,
    });

    await expect(repository.removeForReset(topicId)).rejects.toThrow('Invalid Understanding');
    await expect(repository.get(topicId)).resolves.toEqual(session);
  });

  it('rejects reset when a referenced thread belongs to another user', async () => {
    const session = createSession();
    await repository.install(topicId, session);
    await db.insert(threads).values({
      id: session.runs[0].threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      status: ThreadStatus.Pending,
      topicId,
      type: ThreadType.Isolation,
      userId: otherUserId,
    });

    await expect(repository.removeForReset(topicId)).rejects.toThrow('unowned thread');
    await expect(repository.get(topicId)).resolves.toEqual(session);
  });
});
