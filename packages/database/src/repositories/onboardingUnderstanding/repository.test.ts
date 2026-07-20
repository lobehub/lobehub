// @vitest-environment node
import type {
  CollectionError,
  OnboardingUnderstandingMessageMetadata,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { UserPersonaModel } from '../../models/userMemory/persona';
import {
  agents,
  messages,
  threads,
  topics,
  userPersonaDocumentHistories,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  InvalidUnderstandingSessionError,
  OnboardingUnderstandingRepository,
  StaleUnderstandingRevisionError,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from './repository';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-repository-user';
const otherUserId = 'understanding-repository-other';
const agentId = 'understanding-repository-agent';
const otherAgentId = 'understanding-repository-other-agent';
const topicId = 'understanding-repository-topic';
const sessionId = 'understanding-repository-session';

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [{ description: 'Builds agent systems', salience: 96, title: 'Engineer' }],
    interests: [],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'Agent infrastructure engineer',
    reasoning: 'Repeated source signals',
    tagline: 'Builds reliable agents',
  },
  profile: {
    description: 'Works on agent infrastructure',
    domains: ['AI infrastructure'],
    name: 'Neko',
    pronoun: 'non-specific',
    roles: ['engineer'],
    summary: 'Agent infrastructure engineer',
    tagline: 'Builds reliable agents',
  },
};

const diagnostics = { errors: [], evidenceCount: 4, failedCount: 0, succeededCount: 2 };

const proposal = (
  resultId: string,
  sourceFingerprint: string,
  providers: string[],
  succeededCount: number,
): OnboardingUnderstandingMessageMetadata => ({
  analysis,
  diagnostics: { ...diagnostics, succeededCount },
  kind: 'proposal',
  providers,
  resultId,
  sourceFingerprint,
});

const providerFailure: CollectionError = {
  code: 'GMAIL_SEARCH_FAILED',
  message: 'Gmail search failed',
  operation: 'collect',
  provider: 'gmail',
  retryable: true,
};

const installTopic = async (input?: { id?: string; ownerId?: string; workspaceId?: string }) => {
  await db.insert(topics).values({
    agentId: input?.ownerId && input.ownerId !== userId ? undefined : agentId,
    id: input?.id ?? topicId,
    metadata: {
      model: 'keep-me',
      onboardingSession: {
        lastActiveAt: '2026-07-20T00:00:00.000Z',
        phase: 'user_identity',
        startedAt: '2026-07-20T00:00:00.000Z',
        version: 7,
      },
    },
    userId: input?.ownerId ?? userId,
    workspaceId: input?.workspaceId,
  });
};

const insertAssistantMessage = async (id: string, threadId: string, messageAgentId = agentId) => {
  await db.insert(messages).values({
    agentId: messageAgentId,
    content: JSON.stringify(analysis),
    id,
    metadata: { keep: true },
    role: 'assistant',
    threadId,
    topicId,
    userId,
  });
};

describe('OnboardingUnderstandingRepository', () => {
  let repository: OnboardingUnderstandingRepository;

  const claimAndEnsureWriting = async (input: { sourceFingerprint: string; threadId: string }) => {
    const claim = await repository.claimWriting({
      sessionId,
      sourceFingerprint: input.sourceFingerprint,
      topicId,
    });
    await repository.ensureWritingThread({
      agentId,
      sessionId,
      sourceFingerprint: input.sourceFingerprint,
      threadId: input.threadId,
      topicId,
    });
    return claim;
  };

  beforeEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(agents).values([
      { id: agentId, userId },
      { id: otherAgentId, userId },
    ]);
    await installTopic();
    repository = new OnboardingUnderstandingRepository(db, userId);
  });

  it('initializes once and preserves unrelated topic and onboarding metadata', async () => {
    const first = await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const second = await repository.initialize(topicId, 'ignored-session', ['github']);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      id: sessionId,
      sources: {
        github: { revision: 0, status: 'pending' },
        gmail: { revision: 0, status: 'pending' },
      },
    });
    const [topic] = await db.select({ metadata: topics.metadata }).from(topics);
    expect(topic.metadata).toMatchObject({
      model: 'keep-me',
      onboardingSession: {
        phase: 'user_identity',
        understanding: first,
        version: 7,
      },
    });

    await installTopic({ id: 'invalid-provider-topic' });
    await expect(
      repository.initialize('invalid-provider-topic', 'invalid-provider-session', ['github,bad']),
    ).rejects.toBeInstanceOf(InvalidUnderstandingSessionError);

    await db
      .update(topics)
      .set({
        metadata: {
          ...topic.metadata,
          onboardingSession: {
            ...topic.metadata!.onboardingSession!,
            understanding: {
              ...first,
              sources: { 'github@bad': first.sources.github },
            },
          },
        },
      })
      .where(eq(topics.id, topicId));
    await expect(repository.get(topicId)).rejects.toBeInstanceOf(InvalidUnderstandingSessionError);
  });

  it('advances providers only through the active revision', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const claims = await Promise.all([
      repository.markProviderRunning(topicId, sessionId, 'github'),
      repository.markProviderRunning(topicId, sessionId, 'github'),
    ]);
    expect(claims).toEqual(
      expect.arrayContaining([
        { claimed: true, revision: 1 },
        { claimed: false, revision: 1 },
      ]),
    );
    expect(claims.filter(({ claimed }) => claimed)).toHaveLength(1);
    const revision = 1;
    await expect(
      repository.completeProvider({
        errors: [],
        failedCount: 0,
        providerId: 'github',
        revision: revision - 1,
        sessionId,
        succeededCount: 3,
        topicId,
      }),
    ).rejects.toBeInstanceOf(StaleUnderstandingRevisionError);

    const completed = await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    expect(completed.sources.github).toMatchObject({
      failedCount: 0,
      revision: 1,
      status: 'completed',
      succeededCount: 3,
    });

    const { revision: retryRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'gmail',
    );
    await repository.failProvider({
      errors: [providerFailure],
      failedCount: 1,
      providerId: 'gmail',
      revision: retryRevision,
      sessionId,
      succeededCount: 0,
      topicId,
    });
    expect((await repository.get(topicId))?.sources.gmail).toMatchObject({
      errors: [providerFailure],
      status: 'failed',
    });
  });

  it('derives durable diagnostics from all terminal providers', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const { revision: githubRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: githubRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    const { revision: gmailRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'gmail',
    );
    await repository.failProvider({
      errors: [providerFailure],
      failedCount: 1,
      providerId: 'gmail',
      revision: gmailRevision,
      sessionId,
      succeededCount: 0,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1',
      threadId: 'partial-writing-thread',
    });
    await insertAssistantMessage('partial-message', 'partial-writing-thread');
    const fabricated = proposal('partial-result', 'github@1', ['github'], 999);
    fabricated.diagnostics.failedCount = 999;
    fabricated.diagnostics.errors = [{ ...providerFailure, provider: 'slack' }];

    await expect(
      repository.commitWriting({
        assistantMessageId: 'partial-message',
        metadata: fabricated,
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'partial-writing-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: true });

    const [message] = await db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, 'partial-message'));
    const expectedDiagnostics = {
      errors: [providerFailure],
      evidenceCount: 4,
      failedCount: 1,
      succeededCount: 3,
    };
    expect(message.metadata).toMatchObject({
      onboardingUnderstanding: {
        diagnostics: expectedDiagnostics,
        providers: ['github'],
      },
    });
    expect(JSON.stringify(message.metadata)).not.toContain('slack');
    expect(JSON.stringify(message.metadata)).not.toContain('999');

    await repository.confirm({ resultId: 'partial-result', sessionId, topicId });
    const persona = await new UserPersonaModel(db, userId).getLatestPersonaDocument();
    expect(persona?.metadata).toMatchObject({
      onboardingUnderstanding: {
        diagnostics: { evidenceCount: 4, failedCount: 1, succeededCount: 3 },
        providers: ['github'],
      },
    });
    expect(JSON.stringify(persona?.metadata)).not.toContain('slack');
    expect(JSON.stringify(persona?.metadata)).not.toContain('999');
  });

  it('replays a completed fingerprint after another provider fails without rewriting it', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const { revision: githubRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: githubRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1',
      threadId: 'github-writing-thread',
    });
    await insertAssistantMessage('github-message', 'github-writing-thread');
    const githubProposal = proposal('github-result', 'github@1', ['github'], 3);
    await repository.commitWriting({
      assistantMessageId: 'github-message',
      metadata: githubProposal,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'github-writing-thread',
      topicId,
    });
    await repository.confirm({ resultId: 'github-result', sessionId, topicId });

    const { revision: gmailRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'gmail',
    );
    await repository.failProvider({
      errors: [providerFailure],
      failedCount: 1,
      providerId: 'gmail',
      revision: gmailRevision,
      sessionId,
      succeededCount: 0,
      topicId,
    });

    await expect(
      repository.commitWriting({
        assistantMessageId: 'github-message',
        metadata: githubProposal,
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'github-writing-thread',
        topicId,
      }),
    ).resolves.toEqual({ personaVersion: 1, published: true });

    const [message] = await db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, 'github-message'));
    expect(message.metadata).toEqual({
      keep: true,
      onboardingUnderstanding: githubProposal,
    });
    const persona = await new UserPersonaModel(db, userId).getLatestPersonaDocument();
    expect(persona?.version).toBe(1);
    expect(JSON.stringify(persona?.metadata)).not.toContain('GMAIL_SEARCH_FAILED');
    expect(
      await db
        .select()
        .from(userPersonaDocumentHistories)
        .where(eq(userPersonaDocumentHistories.userId, userId)),
    ).toHaveLength(1);
  });

  it('claims a fingerprint once and rejects a stale proposal after more sources arrive', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const { revision: githubRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: githubRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });

    const firstClaim = await repository.claimWriting({
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });
    expect(
      await db
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, 'github-writing-thread')),
    ).toHaveLength(0);
    await repository.ensureWritingThread({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'github-writing-thread',
      topicId,
    });
    await insertAssistantMessage('stale-message', 'github-writing-thread');
    const duplicateClaim = await repository.claimWriting({
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });
    expect(firstClaim).toEqual({ claimed: true });
    expect(duplicateClaim).toEqual({ claimed: false });

    const { revision: gmailRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'gmail',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'gmail',
      revision: gmailRevision,
      sessionId,
      succeededCount: 2,
      topicId,
    });

    await expect(
      repository.commitWriting({
        assistantMessageId: 'stale-message',
        metadata: proposal('stale-result', 'github@1', ['github'], 3),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'github-writing-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: false });

    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1,gmail@1',
      threadId: 'combined-writing-thread',
    });
    await insertAssistantMessage('current-message', 'combined-writing-thread');

    const writingThreads = await db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.topicId, topicId));
    expect(writingThreads).toEqual(
      expect.arrayContaining([{ id: 'github-writing-thread' }, { id: 'combined-writing-thread' }]),
    );
    await expect(
      db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.threadId, 'combined-writing-thread')),
    ).resolves.toEqual([{ id: 'current-message' }]);

    const combinedProposal = proposal('current-result', 'github@1,gmail@1', ['github', 'gmail'], 5);
    await expect(
      repository.commitWriting({
        assistantMessageId: 'current-message',
        metadata: { ...combinedProposal, providers: ['gmail', 'github'] },
        sessionId,
        sourceFingerprint: 'github@1,gmail@1',
        threadId: 'combined-writing-thread',
        topicId,
      }),
    ).rejects.toThrow('proposal providers');

    await expect(
      repository.commitWriting({
        assistantMessageId: 'current-message',
        metadata: combinedProposal,
        sessionId,
        sourceFingerprint: 'github@1,gmail@1',
        threadId: 'combined-writing-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: true });

    const [message] = await db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, 'current-message'));
    expect(message.metadata).toEqual({
      keep: true,
      onboardingUnderstanding: combinedProposal,
    });
    expect((await repository.get(topicId))?.writing).toMatchObject({
      resultMessageId: 'current-message',
      sourceFingerprint: 'github@1,gmail@1',
      status: 'completed',
    });
  });

  it('rejects thread creation after the claimed writing has failed', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    const { revision } = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await repository.claimWriting({ sessionId, sourceFingerprint: 'github@1', topicId });
    await repository.failWriting({
      error: providerFailure,
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });

    await expect(
      repository.ensureWritingThread({
        agentId,
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'failed-writing-thread',
        topicId,
      }),
    ).rejects.toBeInstanceOf(UnderstandingPreconditionError);
    await expect(
      db.select().from(threads).where(eq(threads.id, 'failed-writing-thread')),
    ).resolves.toHaveLength(0);
  });

  it('confirms version one, then publishes one new Persona version per later fingerprint', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const { revision } = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
    });
    await insertAssistantMessage('github-message', 'writing-thread');
    await repository.commitWriting({
      assistantMessageId: 'github-message',
      metadata: proposal('github-result', 'github@1', ['github'], 3),
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });

    const confirmed = await repository.confirm({
      resultId: 'github-result',
      sessionId,
      topicId,
    });
    expect(confirmed.personaVersion).toBe(1);

    const personaModel = new UserPersonaModel(db, userId);
    const confirmedPersona = await personaModel.getLatestPersonaDocument();
    const userEdit = await personaModel.upsertPersona({
      metadata: confirmedPersona?.metadata,
      persona: 'User-edited persona',
      tagline: 'User-edited tagline',
    });
    expect(userEdit.document.version).toBe(2);

    const replayedConfirmation = await repository.confirm({
      resultId: 'github-result',
      sessionId,
      topicId,
    });
    expect(replayedConfirmation.personaVersion).toBe(2);
    await expect(personaModel.getLatestPersonaDocument()).resolves.toMatchObject({
      persona: 'User-edited persona',
      tagline: 'User-edited tagline',
      version: 2,
    });
    expect(
      await db
        .select()
        .from(userPersonaDocumentHistories)
        .where(eq(userPersonaDocumentHistories.userId, userId)),
    ).toHaveLength(1);

    const { revision: gmailRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'gmail',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'gmail',
      revision: gmailRevision,
      sessionId,
      succeededCount: 2,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1,gmail@1',
      threadId: 'combined-writing-thread',
    });
    await insertAssistantMessage('combined-message', 'combined-writing-thread');
    const combined = proposal('combined-result', 'github@1,gmail@1', ['github', 'gmail'], 5);
    const published = await repository.commitWriting({
      assistantMessageId: 'combined-message',
      metadata: combined,
      sessionId,
      sourceFingerprint: combined.sourceFingerprint,
      threadId: 'combined-writing-thread',
      topicId,
    });
    const replayed = await repository.commitWriting({
      assistantMessageId: 'combined-message',
      metadata: combined,
      sessionId,
      sourceFingerprint: combined.sourceFingerprint,
      threadId: 'combined-writing-thread',
      topicId,
    });

    expect(published).toEqual({ personaVersion: 3, published: true });
    expect(replayed).toEqual({ personaVersion: 3, published: true });
    const persona = await personaModel.getLatestPersonaDocument();
    expect(persona).toMatchObject({ persona: analysis.personaProposal.content, version: 3 });
    expect(persona?.metadata).toMatchObject({
      onboardingUnderstanding: {
        composition: analysis.composition,
        diagnostics: { evidenceCount: 4, failedCount: 0, succeededCount: 5 },
        profile: analysis.profile,
        providers: ['github', 'gmail'],
        sessionId,
        sourceFingerprint: 'github@1,gmail@1',
      },
    });
    const histories = await db
      .select()
      .from(userPersonaDocumentHistories)
      .where(eq(userPersonaDocumentHistories.userId, userId));
    expect(histories).toHaveLength(2);
  });

  it.each(['running', 'failed'] as const)(
    'confirms the retained proposal while a newer writing attempt is %s',
    async (newerStatus) => {
      await repository.initialize(topicId, sessionId, ['github']);
      const { revision } = await repository.markProviderRunning(topicId, sessionId, 'github');
      await repository.completeProvider({
        errors: [],
        failedCount: 0,
        providerId: 'github',
        revision,
        sessionId,
        succeededCount: 3,
        topicId,
      });
      await claimAndEnsureWriting({
        sourceFingerprint: 'github@1',
        threadId: 'retained-writing-thread',
      });
      await insertAssistantMessage('retained-message', 'retained-writing-thread');
      await repository.commitWriting({
        assistantMessageId: 'retained-message',
        metadata: proposal('retained-result', 'github@1', ['github'], 3),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'retained-writing-thread',
        topicId,
      });

      const { revision: newerRevision } = await repository.markProviderRunning(
        topicId,
        sessionId,
        'github',
      );
      await repository.completeProvider({
        errors: [],
        failedCount: 0,
        providerId: 'github',
        revision: newerRevision,
        sessionId,
        succeededCount: 4,
        topicId,
      });
      await repository.claimWriting({
        sessionId,
        sourceFingerprint: 'github@2',
        topicId,
      });
      if (newerStatus === 'failed') {
        await repository.failWriting({
          error: providerFailure,
          sessionId,
          sourceFingerprint: 'github@2',
          topicId,
        });
      }

      await expect(
        repository.confirm({ resultId: 'not-the-retained-result', sessionId, topicId }),
      ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);
      await expect(
        repository.confirm({ resultId: 'retained-result', sessionId, topicId }),
      ).resolves.toEqual({ personaVersion: 1 });

      const persona = await new UserPersonaModel(db, userId).getLatestPersonaDocument();
      expect(persona?.metadata).toMatchObject({
        onboardingUnderstanding: { sourceFingerprint: 'github@1' },
      });
      expect((await repository.get(topicId))?.writing).toMatchObject({
        resultMessageId: 'retained-message',
        sourceFingerprint: 'github@2',
        status: newerStatus,
      });
    },
  );

  it('rejects proposal messages that are not owned by the writing thread agent', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    const { revision } = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1',
      threadId: 'agent-owned-writing-thread',
    });
    await insertAssistantMessage('wrong-agent-message', 'agent-owned-writing-thread', otherAgentId);

    await expect(
      repository.commitWriting({
        assistantMessageId: 'wrong-agent-message',
        metadata: proposal('wrong-agent-result', 'github@1', ['github'], 3),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'agent-owned-writing-thread',
        topicId,
      }),
    ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);

    await insertAssistantMessage('owned-message', 'agent-owned-writing-thread');
    await repository.commitWriting({
      assistantMessageId: 'owned-message',
      metadata: proposal('owned-result', 'github@1', ['github'], 3),
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'agent-owned-writing-thread',
      topicId,
    });
    await db
      .update(messages)
      .set({ agentId: otherAgentId })
      .where(eq(messages.id, 'owned-message'));

    await expect(
      repository.confirm({ resultId: 'owned-result', sessionId, topicId }),
    ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);
  });

  it('guards stale failures and preserves the valid proposal while a newer write fails', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    const { revision: firstRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: firstRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
    });
    await insertAssistantMessage('valid-message', 'writing-thread');
    await repository.commitWriting({
      assistantMessageId: 'valid-message',
      metadata: proposal('valid-result', 'github@1', ['github'], 3),
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });
    const { revision: secondRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: secondRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@2',
      threadId: 'second-writing-thread',
    });

    await repository.failWriting({
      error: providerFailure,
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });
    expect((await repository.get(topicId))?.writing).toMatchObject({
      resultMessageId: 'valid-message',
      sourceFingerprint: 'github@2',
      status: 'running',
    });

    await repository.failWriting({
      error: providerFailure,
      sessionId,
      sourceFingerprint: 'github@2',
      topicId,
    });
    expect((await repository.get(topicId))?.writing).toMatchObject({
      resultMessageId: 'valid-message',
      sourceFingerprint: 'github@2',
      status: 'failed',
    });
  });

  it('resets only the owned personal session and rejects other-user and workspace topics', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    const { revision } = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
    });
    const { revision: secondRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: secondRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await claimAndEnsureWriting({
      sourceFingerprint: 'github@2',
      threadId: 'second-writing-thread',
    });
    const removed = await repository.removeForReset(topicId);
    expect(removed?.id).toBe(sessionId);
    expect(await repository.get(topicId)).toBeUndefined();
    expect(await db.select().from(threads).where(eq(threads.id, 'writing-thread'))).toHaveLength(0);
    expect(
      await db.select().from(threads).where(eq(threads.id, 'second-writing-thread')),
    ).toHaveLength(0);

    await installTopic({ id: 'other-topic', ownerId: otherUserId });
    const otherRepository = new OnboardingUnderstandingRepository(db, otherUserId);
    await otherRepository.initialize('other-topic', 'other-session', ['github']);
    await db.insert(workspaces).values({
      id: 'understanding-workspace',
      name: 'Workspace',
      primaryOwnerId: userId,
      slug: 'understanding-workspace',
    });
    await installTopic({ id: 'workspace-topic', workspaceId: 'understanding-workspace' });

    await expect(
      repository.initialize('other-topic', 'other-session', ['github']),
    ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);
    await expect(repository.get('other-topic')).resolves.toBeUndefined();
    await expect(
      repository.initialize('workspace-topic', 'workspace-session', ['github']),
    ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);
    await expect(repository.get('workspace-topic')).resolves.toBeUndefined();
    await expect(
      repository.markProviderRunning(topicId, sessionId, 'github'),
    ).rejects.toBeInstanceOf(UnderstandingSessionNotFoundError);
  });
});
