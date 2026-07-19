import type {
  CollectionDiagnostics,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
  UnderstandingMergedResult,
  UnderstandingSourceResult,
} from '@lobechat/types';
import { ThreadStatus } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messages, threads, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UnderstandingResultRepository } from './result';
import { UnderstandingSessionRepository } from './session';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-result-user';
const otherUserId = 'understanding-result-other';
const topicId = 'understanding-result-topic';
const agentId = 'understanding-result-agent';
const sourceRun = {
  assistantMessageId: 'source-message',
  source: { externalAccountId: 'neko', id: 'github:neko', provider: 'github' },
  status: 'running' as const,
  threadId: 'source-thread',
};
const session: OnboardingUnderstandingSession = {
  id: 'result-session',
  runs: [sourceRun],
  status: 'processing',
};
const diagnostics: CollectionDiagnostics = {
  errors: [],
  evidenceCount: 4,
  failedCount: 0,
  succeededCount: 2,
};
const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [{ description: 'Builds agent systems.', salience: 96, title: 'Agent systems' }],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'You build agents.',
    reasoning: 'Source backed.',
    tagline: 'Builder',
  },
  profile: {
    description: 'Engineer',
    domains: ['AI'],
    name: 'Neko',
    pronoun: 'she/her',
    roles: ['engineer'],
    summary: 'Builds AI systems.',
    tagline: 'AI engineer',
  },
};
const sourceResult: UnderstandingSourceResult = {
  analysis,
  diagnostics,
  kind: 'source',
  resultId: 'source-result',
  source: sourceRun.source,
};
const sourceIdentity = {
  assistantMessageId: sourceRun.assistantMessageId,
  sessionId: session.id,
  sourceId: sourceRun.source.id,
  threadId: sourceRun.threadId,
  topicId,
};

describe('UnderstandingResultRepository', () => {
  let repository: UnderstandingResultRepository;
  let sessionRepository: UnderstandingSessionRepository;

  beforeEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(agents).values({ id: agentId, userId });
    await db.insert(topics).values({
      agentId,
      id: topicId,
      metadata: {
        onboardingSession: {
          lastActiveAt: '2026-07-15T00:00:00.000Z',
          phase: 'user_identity',
          startedAt: '2026-07-15T00:00:00.000Z',
          version: 1,
        },
      },
      userId,
    });
    sessionRepository = new UnderstandingSessionRepository(db, userId);
    await sessionRepository.install(topicId, session);
    repository = new UnderstandingResultRepository(db, userId);
  });

  afterEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  });

  it('creates an owned hidden source thread', async () => {
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });

    const [thread] = await db.select().from(threads);
    expect(thread).toMatchObject({
      id: sourceRun.threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      status: ThreadStatus.Pending,
      topicId,
      userId,
    });
  });

  it('atomically finalizes and reads a source result through its active run identity', async () => {
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    await db.insert(messages).values({
      agentId,
      content: JSON.stringify(analysis),
      id: sourceRun.assistantMessageId,
      metadata: { keep: true },
      role: 'assistant',
      threadId: sourceRun.threadId,
      topicId,
      userId,
    });

    await expect(
      repository.finalizeSource({ agentId, metadata: sourceResult, ...sourceIdentity }),
    ).resolves.toEqual(sourceResult);
    await expect(repository.readSource(sourceIdentity)).resolves.toEqual(sourceResult);

    const [message] = await db.select().from(messages);
    const [thread] = await db.select().from(threads);
    const persisted = await sessionRepository.get(topicId);
    expect(message.metadata).toMatchObject({ keep: true, onboardingUnderstanding: sourceResult });
    expect(thread.status).toBe(ThreadStatus.Completed);
    expect(persisted?.runs[0]).toMatchObject({
      diagnostics: { evidenceCount: 4, failedCount: 0, succeededCount: 2 },
      resultId: sourceResult.resultId,
      status: 'completed',
    });
  });

  it('returns undefined while active result artifacts are not ready', async () => {
    await expect(repository.readSource(sourceIdentity)).resolves.toBeUndefined();
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    await expect(repository.readSource(sourceIdentity)).resolves.toBeUndefined();
  });

  it('accepts an exact replay and rejects a conflicting terminal result', async () => {
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    await db.insert(messages).values({
      agentId,
      content: '',
      id: sourceRun.assistantMessageId,
      role: 'assistant',
      threadId: sourceRun.threadId,
      topicId,
      userId,
    });
    await repository.finalizeSource({ agentId, metadata: sourceResult, ...sourceIdentity });

    await expect(
      repository.finalizeSource({ agentId, metadata: sourceResult, ...sourceIdentity }),
    ).resolves.toEqual(sourceResult);
    await expect(
      repository.finalizeSource({
        agentId,
        metadata: { ...sourceResult, resultId: 'different-result' },
        ...sourceIdentity,
      }),
    ).rejects.toThrow('already finalized');
  });

  it('rejects stale thread and assistant message references', async () => {
    await sessionRepository.updateSourceRun(
      topicId,
      session.id,
      sourceRun.source.id,
      sourceRun.threadId,
      { assistantMessageId: 'replacement-message' },
    );

    await expect(
      repository.finalizeSource({ agentId, metadata: sourceResult, ...sourceIdentity }),
    ).rejects.toThrow('no longer active');
    await expect(repository.readSource(sourceIdentity)).rejects.toThrow('no longer active');
  });

  it('rejects a result thread occupied by another user', async () => {
    await db.insert(threads).values({
      agentId,
      id: sourceRun.threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      status: ThreadStatus.Pending,
      topicId,
      type: 'isolation',
      userId: otherUserId,
    });

    await expect(
      repository.finalizeSource({ agentId, metadata: sourceResult, ...sourceIdentity }),
    ).rejects.toThrow('Invalid Understanding result thread');
  });

  it('finalizes a merge only for the current completed source run set', async () => {
    await sessionRepository.updateSourceRun(
      topicId,
      session.id,
      sourceRun.source.id,
      sourceRun.threadId,
      { diagnostics: { evidenceCount: 4, failedCount: 0, succeededCount: 2 }, status: 'completed' },
    );
    const mergeRun = {
      assistantMessageId: 'merge-message',
      status: 'running' as const,
      threadId: 'merge-thread',
    };
    await sessionRepository.setMergeRun(topicId, session.id, mergeRun);
    const identity = {
      assistantMessageId: mergeRun.assistantMessageId,
      sessionId: session.id,
      threadId: mergeRun.threadId,
      topicId,
    };
    const mergedResult: UnderstandingMergedResult = {
      analysis,
      diagnostics,
      inputThreadIds: [sourceRun.threadId],
      kind: 'merged',
      resultId: 'merge-result',
    };

    await repository.ensureThread({
      agentId,
      kind: 'merged',
      threadId: mergeRun.threadId,
      topicId,
    });
    await db.insert(messages).values({
      agentId,
      content: '',
      id: mergeRun.assistantMessageId,
      role: 'assistant',
      threadId: mergeRun.threadId,
      topicId,
      userId,
    });
    await expect(
      repository.finalizeMerge({ agentId, metadata: mergedResult, ...identity }),
    ).resolves.toEqual(mergedResult);
    await expect(repository.readMerge(identity)).resolves.toEqual(mergedResult);
    await expect(sessionRepository.get(topicId)).resolves.toMatchObject({
      mergeRun: { resultId: 'merge-result', status: 'completed' },
      status: 'completed',
    });
  });

  it('rejects merge metadata whose inputs differ from completed active source runs', async () => {
    const mergeRun = {
      assistantMessageId: 'merge-message',
      status: 'running' as const,
      threadId: 'merge-thread',
    };
    await sessionRepository.setMergeRun(topicId, session.id, mergeRun);

    await expect(
      repository.finalizeMerge({
        agentId,
        assistantMessageId: mergeRun.assistantMessageId,
        metadata: {
          analysis,
          diagnostics,
          inputThreadIds: [sourceRun.threadId],
          kind: 'merged',
          resultId: 'merge-result',
        },
        sessionId: session.id,
        threadId: mergeRun.threadId,
        topicId,
      }),
    ).rejects.toThrow('does not match completed source runs');
  });

  it('rejects access from another user', async () => {
    const otherRepository = new UnderstandingResultRepository(db, otherUserId);
    await expect(otherRepository.readSource(sourceIdentity)).rejects.toThrow();
  });

  it('claims a stable message identity for a source failure before an agent message exists', async () => {
    await sessionRepository.updateSourceRun(
      topicId,
      session.id,
      sourceRun.source.id,
      sourceRun.threadId,
      { assistantMessageId: undefined },
    );
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    const metadata: UnderstandingSourceResult = {
      diagnostics,
      kind: 'source_error',
      resultId: 'source-error-result',
      source: sourceRun.source,
    };
    const input = {
      agentId,
      assistantMessageId: 'source-error-message',
      metadata,
      sessionId: session.id,
      sourceId: sourceRun.source.id,
      threadId: sourceRun.threadId,
      topicId,
    };

    await expect(repository.finalizeSource(input)).resolves.toEqual(metadata);
    await expect(repository.finalizeSource(input)).resolves.toEqual(metadata);
    await expect(
      repository.finalizeSource({ ...input, assistantMessageId: 'conflicting-message' }),
    ).rejects.toThrow('no longer active');

    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, input.assistantMessageId));
    expect(message).toMatchObject({
      content: 'Understanding source analysis failed.',
      role: 'assistant',
      threadId: sourceRun.threadId,
    });
    await expect(sessionRepository.get(topicId)).resolves.toMatchObject({
      runs: [
        {
          assistantMessageId: input.assistantMessageId,
          resultId: metadata.resultId,
          status: 'failed',
        },
      ],
    });
  });

  it('claims a stable message identity for a merge failure before an agent message exists', async () => {
    await sessionRepository.updateSourceRun(
      topicId,
      session.id,
      sourceRun.source.id,
      sourceRun.threadId,
      { status: 'completed' },
    );
    const mergeRun = { status: 'running' as const, threadId: 'merge-error-thread' };
    await sessionRepository.setMergeRun(topicId, session.id, mergeRun);
    await repository.ensureThread({
      agentId,
      kind: 'merged',
      threadId: mergeRun.threadId,
      topicId,
    });
    const metadata: UnderstandingMergedResult = {
      diagnostics,
      inputThreadIds: [sourceRun.threadId],
      kind: 'merge_error',
      resultId: 'merge-error-result',
    };

    await expect(
      repository.finalizeMerge({
        agentId,
        assistantMessageId: 'merge-error-message',
        metadata,
        sessionId: session.id,
        threadId: mergeRun.threadId,
        topicId,
      }),
    ).resolves.toEqual(metadata);

    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, 'merge-error-message'));
    expect(message).toMatchObject({
      content: 'Understanding profile synthesis failed.',
      role: 'assistant',
      threadId: mergeRun.threadId,
    });
    await expect(sessionRepository.get(topicId)).resolves.toMatchObject({
      mergeRun: {
        assistantMessageId: 'merge-error-message',
        resultId: metadata.resultId,
        status: 'failed',
      },
    });
  });

  it('rejects an unowned message identity when claiming a terminal failure', async () => {
    await sessionRepository.updateSourceRun(
      topicId,
      session.id,
      sourceRun.source.id,
      sourceRun.threadId,
      { assistantMessageId: undefined },
    );
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    await db.insert(threads).values({
      agentId,
      id: 'other-message-thread',
      status: ThreadStatus.Pending,
      topicId,
      type: 'isolation',
      userId: otherUserId,
    });
    await db.insert(messages).values({
      agentId,
      content: '',
      id: 'occupied-message',
      role: 'assistant',
      threadId: 'other-message-thread',
      topicId,
      userId: otherUserId,
    });

    await expect(
      repository.finalizeSource({
        agentId,
        assistantMessageId: 'occupied-message',
        metadata: {
          diagnostics,
          kind: 'source_error',
          resultId: 'source-error-result',
          source: sourceRun.source,
        },
        sessionId: session.id,
        sourceId: sourceRun.source.id,
        threadId: sourceRun.threadId,
        topicId,
      }),
    ).rejects.toThrow('identity is already occupied');
  });

  it('rejects corrupt metadata on an existing active message', async () => {
    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    await db.insert(messages).values({
      agentId,
      content: '',
      id: sourceRun.assistantMessageId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      role: 'assistant',
      threadId: sourceRun.threadId,
      topicId,
      userId,
    });

    await expect(repository.readSource(sourceIdentity)).rejects.toThrow();
  });
});
