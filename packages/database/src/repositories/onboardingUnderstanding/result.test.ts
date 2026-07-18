import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { ThreadStatus } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
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
  operationId: 'source-operation',
  source: { externalAccountId: 'neko', id: 'github:neko', provider: 'github' },
  status: 'analyzing' as const,
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
const result: OnboardingUnderstandingMessageMetadata = {
  analysis,
  diagnostics,
  kind: 'source',
  resultId: 'result-source-operation',
  source: sourceRun.source,
};

describe('UnderstandingResultRepository', () => {
  let repository: UnderstandingResultRepository;

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
    await new UnderstandingSessionRepository(db, userId).install(topicId, session);
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

  it('persists and reads a validated source result from the agent message', async () => {
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
      repository.persist({
        agentId,
        metadata: result,
        operationId: sourceRun.operationId,
        sessionId: session.id,
        topicId,
      }),
    ).resolves.toEqual(result);
    await expect(
      repository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).resolves.toEqual(result);

    const [message] = await db.select().from(messages);
    const [thread] = await db.select().from(threads);
    expect(message.metadata).toMatchObject({ keep: true, onboardingUnderstanding: result });
    expect(thread.status).toBe(ThreadStatus.Completed);
  });

  it('returns undefined while the expected result artifacts are not ready', async () => {
    await expect(
      repository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).resolves.toBeUndefined();

    await repository.ensureThread({
      agentId,
      kind: 'source',
      threadId: sourceRun.threadId,
      topicId,
    });
    await expect(
      repository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).resolves.toBeUndefined();

    await db.insert(messages).values({
      agentId,
      content: '',
      id: sourceRun.assistantMessageId,
      metadata: { keep: true },
      role: 'assistant',
      threadId: sourceRun.threadId,
      topicId,
      userId,
    });
    await expect(
      repository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).resolves.toBeUndefined();
  });

  it('rejects corrupt result metadata on an existing referenced message', async () => {
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

    await expect(
      repository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).rejects.toThrow();
  });

  it('rejects an expected thread id occupied by another owner', async () => {
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
      repository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).rejects.toThrow();
  });

  it('accepts an exact duplicate terminal write idempotently', async () => {
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

    await repository.persist({
      agentId,
      metadata: result,
      operationId: sourceRun.operationId,
      sessionId: session.id,
      topicId,
    });
    await expect(
      repository.persist({
        agentId,
        metadata: result,
        operationId: sourceRun.operationId,
        sessionId: session.id,
        topicId,
      }),
    ).resolves.toEqual(result);
  });

  it('rejects access from another user', async () => {
    const otherRepository = new UnderstandingResultRepository(db, otherUserId);
    await expect(
      otherRepository.read({ operationId: sourceRun.operationId, sessionId: session.id, topicId }),
    ).rejects.toThrow();
  });
});
