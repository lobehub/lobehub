// @vitest-environment node
import type {
  OnboardingTaskRecommendationSession,
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
  OnboardingUnderstandingRepository,
  StaleUnderstandingRevisionError,
  UnderstandingResourceNotFoundError,
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
    identities: [
      {
        description: 'TEST_IDENTITY_DESCRIPTION',
        rank: 96,
        title: 'TEST_IDENTITY_TITLE',
      },
    ],
    interests: [],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'TEST_PERSONA_CONTENT',
    reasoning: 'TEST_PERSONA_REASONING',
    tagline: 'TEST_PERSONA_TAGLINE',
  },
  profile: {
    description: 'TEST_PROFILE_DESCRIPTION',
    domains: ['TEST_PROFILE_DOMAIN'],
    name: 'TEST_PROFILE_NAME',
    pronoun: 'TEST_PROFILE_PRONOUN',
    roles: ['TEST_PROFILE_ROLE'],
    summary: 'TEST_PROFILE_SUMMARY',
    tagline: 'TEST_PROFILE_TAGLINE',
  },
};

const proposal = (
  resultId: string,
  sourceFingerprint: string,
  providers: string[],
  succeededCount: number,
  revisions?: { feedbackRevision: number; generationRevision: number },
): OnboardingUnderstandingMessageMetadata => ({
  analysis,
  diagnostics: { errors: [], evidenceCount: 4, failedCount: 0, succeededCount },
  ...revisions,
  kind: 'proposal',
  providers,
  resultId,
  sourceFingerprint,
});

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

const insertAssistant = async (
  id: string,
  threadId: string,
  input?: { agent?: string; owner?: string; topic?: string; workspaceId?: string },
) => {
  await db.insert(messages).values({
    agentId: input?.agent ?? agentId,
    content: JSON.stringify(analysis),
    id,
    metadata: { keep: true },
    role: 'assistant',
    threadId,
    topicId: input?.topic ?? topicId,
    userId: input?.owner ?? userId,
    workspaceId: input?.workspaceId,
  });
};

describe('OnboardingUnderstandingRepository', () => {
  let repository: OnboardingUnderstandingRepository;

  const completeProvider = async (providerId: string, succeededCount: number) => {
    const { revision } = await repository.markProviderRunning(topicId, sessionId, providerId);
    return repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId,
      revision,
      sessionId,
      succeededCount,
      topicId,
    });
  };

  const publish = async (
    fingerprint: string,
    providers: string[],
    messageId: string,
    threadId: string,
  ) => {
    const prepared = await repository.prepareWriting({
      agentId,
      sessionId,
      sourceFingerprint: fingerprint,
      threadId,
      topicId,
    });
    expect(prepared).toMatchObject({ ready: true, threadId });
    await insertAssistant(messageId, threadId);
    const published = await repository.commitWriting({
      assistantMessageId: messageId,
      feedbackRevision: prepared.feedbackRevision,
      generationRevision: prepared.generationRevision,
      metadata: proposal(messageId, fingerprint, providers, providers.length === 1 ? 3 : 5, {
        feedbackRevision: prepared.feedbackRevision,
        generationRevision: prepared.generationRevision,
      }),
      sessionId,
      sourceFingerprint: fingerprint,
      threadId,
      topicId,
    });
    if (published.published) {
      await repository.commitDetailedWriting({
        detailedPersona: {
          content: 'TEST_DETAILED_PERSONA_CONTENT',
          reasoning: 'TEST_DETAILED_PERSONA_REASONING',
          tagline: 'TEST_DETAILED_PERSONA_TAGLINE',
        },
        feedbackRevision: prepared.feedbackRevision,
        generationRevision: prepared.generationRevision,
        sessionId,
        sourceFingerprint: fingerprint,
        topicId,
      });
    }
    return published;
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

  /** @example A provider workflow failure after collection creates terminal writing state. */
  it('records writing failure before a generation is prepared', async () => {
    // ROOT CAUSE:
    //
    // A provider workflow can fail after all sources complete but before prepareWriting runs. The
    // repository previously required an existing writing revision, so its failure callback became a
    // no-op and the session projected as `processing` forever.
    //
    // We fixed this by allowing the current completed fingerprint to initialize failed writing state.
    await repository.initialize(topicId, sessionId, ['github']);
    await completeProvider('github', 3);

    const failed = await repository.failWriting({
      error: {
        code: 'UNDERSTANDING_WRITING_FAILED',
        message: 'understanding writing failed',
        operation: 'writing',
        provider: 'understanding',
        retryable: true,
      },
      feedbackRevision: 0,
      generationRevision: 0,
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });

    expect(failed.writing).toMatchObject({
      feedbackRevision: 0,
      generationRevision: 0,
      sourceFingerprint: 'github@1',
      status: 'failed',
    });
  });

  /** @example A fresh onboarding run cannot inherit completed starter-task recommendations. */
  it('removes Understanding and task recommendations together on reset', async () => {
    const taskRecommendations: OnboardingTaskRecommendationSession = {
      createdTaskIds: {},
      errors: [],
      id: sessionId,
      providerIds: ['github'],
      recommendations: [],
      sourceFingerprint: 'github@1',
      status: 'pending',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    const [existing] = await db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topicId));
    await db
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          onboardingSession: {
            ...existing.metadata!.onboardingSession!,
            taskRecommendations,
          },
        },
      })
      .where(eq(topics.id, topicId));
    await repository.initialize(topicId, sessionId, ['github']);

    await repository.removeForReset(topicId);

    const [resetTopic] = await db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topicId));
    expect(resetTopic.metadata?.model).toBe('keep-me');
    expect(resetTopic.metadata?.onboardingSession?.understanding).toBeUndefined();
    expect(resetTopic.metadata?.onboardingSession?.taskRecommendations).toBeUndefined();
  });

  /**
   * @example
   * expect(session.feedback?.revision).toBe(2);
   */
  it('adds sources monotonically and accumulates immutable feedback turns', async () => {
    await repository.initialize(topicId, sessionId, ['github']);

    const first = await repository.extend({
      expectedFeedbackRevision: 0,
      feedback: 'Focus on my open-source infrastructure work.',
      providerIds: ['github', 'gmail'],
      sessionId,
      topicId,
    });
    const second = await repository.extend({
      expectedFeedbackRevision: 1,
      feedback: 'Do not treat newsletters as durable interests.',
      providerIds: ['gmail'],
      sessionId,
      topicId,
    });

    expect(first.session.sources).toEqual({
      github: expect.objectContaining({ revision: 0, status: 'pending' }),
      gmail: expect.objectContaining({ revision: 1, status: 'running' }),
    });
    expect(second.session.feedback).toEqual({
      revision: 2,
      turns: [
        expect.objectContaining({
          content: 'Focus on my open-source infrastructure work.',
          revision: 1,
        }),
        expect.objectContaining({
          content: 'Do not treat newsletters as durable interests.',
          revision: 2,
        }),
      ],
    });
    await expect(
      repository.extend({
        expectedFeedbackRevision: 1,
        feedback: 'Duplicate stale submission.',
        providerIds: [],
        sessionId,
        topicId,
      }),
    ).rejects.toThrow('feedback is no longer active');
  });

  /** @example A newly connected GitHub source runs while a Gmail permission failure stays failed. */
  it('adds new providers without retrying non-retryable provider failures', async () => {
    // ROOT CAUSE:
    //
    // The original session manifest was immutable during retry. Returning to connector setup and
    // adding GitHub therefore retried only the existing Gmail failure, while GitHub never entered
    // the session. Permission failures were also retried even though the OAuth grant had not changed.
    //
    // We fixed this with one locked mutation that adds new providers and restarts only failures whose
    // persisted diagnostics explicitly allow retry.
    await repository.initialize(topicId, sessionId, ['gmail']);
    const { revision } = await repository.markProviderRunning(topicId, sessionId, 'gmail');
    await repository.failProvider({
      errors: [
        {
          code: 'GMAIL_READ_PERMISSION_REQUIRED',
          message: 'Gmail read permission is required',
          operation: 'permission',
          provider: 'gmail',
          retryable: false,
        },
      ],
      failedCount: 1,
      providerId: 'gmail',
      revision,
      sessionId,
      succeededCount: 0,
      topicId,
    });

    const reconciled = await repository.extend({
      expectedFeedbackRevision: 0,
      providerIds: ['gmail', 'github'],
      sessionId,
      topicId,
    });

    expect(reconciled.attempts).toEqual([{ id: 'github', revision: 1 }]);
    expect(reconciled.session.sources).toMatchObject({
      github: { errors: [], revision: 1, status: 'running' },
      gmail: {
        errors: [expect.objectContaining({ code: 'GMAIL_READ_PERMISSION_REQUIRED' })],
        revision: 1,
        status: 'failed',
      },
    });
  });

  /** @example Provider-only revision succeeds without carrying feedback concurrency state. */
  it('does not require a feedback revision when only providers change', async () => {
    await repository.initialize(topicId, sessionId, ['github']);

    const revised = await repository.extend({
      providerIds: ['github', 'gmail'],
      sessionId,
      topicId,
    });

    expect(revised.attempts).toEqual([{ id: 'gmail', revision: 1 }]);
    expect(revised.session.sources.gmail).toMatchObject({ revision: 1, status: 'running' });
  });

  /**
   * @example
   * expect(stale.published).toBe(false);
   */
  it('publishes only the latest feedback and source generation', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    await completeProvider('github', 3);
    const first = await repository.prepareWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'generation-1-thread',
      topicId,
    });
    await insertAssistant('generation-1-result', 'generation-1-thread');

    await repository.extend({
      expectedFeedbackRevision: 0,
      feedback: 'Focus on infrastructure.',
      providerIds: [],
      sessionId,
      topicId,
    });
    const second = await repository.prepareWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'generation-2-thread',
      topicId,
    });
    await insertAssistant('generation-2-result', 'generation-2-thread');

    await expect(
      repository.commitWriting({
        assistantMessageId: 'generation-1-result',
        feedbackRevision: first.feedbackRevision,
        generationRevision: first.generationRevision,
        metadata: proposal('generation-1-result', 'github@1', ['github'], 3, {
          feedbackRevision: first.feedbackRevision,
          generationRevision: first.generationRevision,
        }),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'generation-1-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: false });
    await expect(
      repository.commitWriting({
        assistantMessageId: 'generation-2-result',
        feedbackRevision: second.feedbackRevision,
        generationRevision: second.generationRevision,
        metadata: proposal('generation-2-result', 'github@1', ['github'], 3, {
          feedbackRevision: second.feedbackRevision,
          generationRevision: second.generationRevision,
        }),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'generation-2-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: true });
  });

  it('freezes the confirmed proposal while preserving later user edits', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    await completeProvider('github', 3);
    await expect(
      publish('github@1', ['github'], 'github-result', 'github-thread'),
    ).resolves.toEqual({
      published: true,
    });
    const completedWriting = await repository.failWriting({
      error: {
        code: 'UNDERSTANDING_WRITING_FAILED',
        message: 'understanding writing failed',
        operation: 'writing',
        provider: 'understanding',
        retryable: true,
      },
      feedbackRevision: 0,
      generationRevision: 1,
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });
    expect(completedWriting.writing).toMatchObject({
      resultMessageId: 'github-result',
      status: 'completed',
    });

    await expect(
      repository.confirm({ resultId: 'github-result', sessionId, topicId }),
    ).rejects.toThrow('result_not_confirmable');

    await completeProvider('gmail', 2);
    await expect(
      publish('github@1,gmail@1', ['github', 'gmail'], 'combined-result', 'combined-thread'),
    ).resolves.toEqual({
      published: true,
    });
    await expect(
      repository.confirm({ resultId: 'combined-result', sessionId, topicId }),
    ).resolves.toEqual({ personaVersion: 1 });
    const persona = new UserPersonaModel(db, userId);
    await expect(persona.getLatestPersonaDocument()).resolves.toMatchObject({
      persona: 'TEST_DETAILED_PERSONA_CONTENT',
      tagline: 'TEST_DETAILED_PERSONA_TAGLINE',
      version: 1,
    });
    await persona.upsertPersona({ persona: 'User-edited persona', tagline: 'User-edited tagline' });
    await expect(
      repository.confirm({ resultId: 'combined-result', sessionId, topicId }),
    ).resolves.toEqual({ personaVersion: 2 });
    await expect(persona.getLatestPersonaDocument()).resolves.toMatchObject({
      persona: 'User-edited persona',
      tagline: 'User-edited tagline',
      version: 2,
    });

    await expect(
      repository.prepareWriting({
        agentId,
        sessionId,
        sourceFingerprint: 'github@1,gmail@1',
        threadId: 'another-thread',
        topicId,
      }),
    ).rejects.toThrow('session_confirmed');
    await expect(
      repository.extend({
        expectedFeedbackRevision: 0,
        feedback: 'This must not update a confirmed session.',
        providerIds: [],
        sessionId,
        topicId,
      }),
    ).rejects.toThrow('session_confirmed');
    await expect(persona.getLatestPersonaDocument()).resolves.toMatchObject({
      persona: 'User-edited persona',
      version: 2,
    });
    expect(
      await db
        .select()
        .from(userPersonaDocumentHistories)
        .where(eq(userPersonaDocumentHistories.userId, userId)),
    ).toHaveLength(1);
  });

  it('rejects delayed provider revisions and refuses stale writing fingerprints', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const { revision: firstRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await repository.failProvider({
      errors: [],
      failedCount: 1,
      providerId: 'github',
      revision: firstRevision,
      sessionId,
      succeededCount: 0,
      topicId,
    });
    const { revision: secondRevision } = await repository.markProviderRunning(
      topicId,
      sessionId,
      'github',
    );
    await expect(
      repository.completeProvider({
        errors: [],
        failedCount: 0,
        providerId: 'github',
        revision: firstRevision,
        sessionId,
        succeededCount: 3,
        topicId,
      }),
    ).rejects.toBeInstanceOf(StaleUnderstandingRevisionError);
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: secondRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await repository.prepareWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@2',
      threadId: 'current-thread',
      topicId,
    });
    const afterStaleFailure = await repository.failWriting({
      error: {
        code: 'UNDERSTANDING_WRITING_FAILED',
        message: 'understanding writing failed',
        operation: 'writing',
        provider: 'understanding',
        retryable: true,
      },
      feedbackRevision: 0,
      generationRevision: 0,
      sessionId,
      sourceFingerprint: 'github@1',
      topicId,
    });
    expect(afterStaleFailure.writing).toMatchObject({
      sourceFingerprint: 'github@2',
      status: 'running',
    });
    await expect(
      repository.prepareWriting({
        agentId,
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'stale-thread',
        topicId,
      }),
    ).resolves.toMatchObject({ ready: false, threadId: 'stale-thread' });
    await expect(
      repository.commitWriting({
        assistantMessageId: 'missing-stale-result',
        feedbackRevision: 0,
        generationRevision: 0,
        metadata: proposal('missing-stale-result', 'github@1', ['github'], 3),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'stale-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: false });
  });

  it('expires all exact missing revisions while retaining the previous proposal', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    await completeProvider('github', 3);
    await publish('github@1', ['github'], 'retained-result', 'retained-thread');
    await completeProvider('gmail', 2);

    const expired = await repository.expireProviderContexts({
      providers: [
        { providerId: 'github', revision: 1 },
        { providerId: 'gmail', revision: 1 },
      ],
      sessionId,
      sourceFingerprint: 'github@1,gmail@1',
      topicId,
    });

    expect(expired.sources.gmail).toMatchObject({
      failedCount: 1,
      revision: 1,
      status: 'failed',
      succeededCount: 2,
    });
    expect(expired.sources.github).toMatchObject({
      failedCount: 1,
      revision: 1,
      status: 'failed',
      succeededCount: 3,
    });
    expect(expired.writing).toMatchObject({
      resultMessageId: 'retained-result',
      status: 'failed',
    });
    await expect(repository.markProviderRunning(topicId, sessionId, 'gmail')).resolves.toEqual({
      revision: 2,
    });
  });

  it('scopes every operation and writing resource to an owned personal topic', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    await completeProvider('github', 3);
    await expect(
      repository.prepareWriting({
        agentId,
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'owned-thread',
        topicId,
      }),
    ).resolves.toMatchObject({ ready: true, threadId: 'owned-thread' });
    await insertAssistant('wrong-agent-message', 'owned-thread', { agent: otherAgentId });
    await expect(
      repository.commitWriting({
        assistantMessageId: 'wrong-agent-message',
        feedbackRevision: 0,
        generationRevision: 1,
        metadata: proposal('wrong-agent-message', 'github@1', ['github'], 3, {
          feedbackRevision: 0,
          generationRevision: 1,
        }),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'owned-thread',
        topicId,
      }),
    ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);

    await installTopic({ id: 'other-topic', ownerId: otherUserId });
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
    await expect(
      repository.initialize('workspace-topic', 'workspace-session', ['github']),
    ).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);
    await expect(repository.get('other-topic')).resolves.toBeUndefined();
    await expect(repository.get('workspace-topic')).resolves.toBeUndefined();

    const inaccessibleOperations = (inaccessibleTopicId: string) => [
      () => repository.markProviderRunning(inaccessibleTopicId, 'inaccessible-session', 'github'),
      () =>
        repository.completeProvider({
          errors: [],
          failedCount: 0,
          providerId: 'github',
          revision: 1,
          sessionId: 'inaccessible-session',
          succeededCount: 1,
          topicId: inaccessibleTopicId,
        }),
      () =>
        repository.failProvider({
          errors: [],
          failedCount: 1,
          providerId: 'github',
          revision: 1,
          sessionId: 'inaccessible-session',
          succeededCount: 0,
          topicId: inaccessibleTopicId,
        }),
      () =>
        repository.expireProviderContexts({
          providers: [{ providerId: 'github', revision: 1 }],
          sessionId: 'inaccessible-session',
          sourceFingerprint: 'github@1',
          topicId: inaccessibleTopicId,
        }),
      () =>
        repository.prepareWriting({
          agentId,
          sessionId: 'inaccessible-session',
          sourceFingerprint: 'github@1',
          threadId: 'inaccessible-thread',
          topicId: inaccessibleTopicId,
        }),
      () =>
        repository.commitWriting({
          assistantMessageId: 'inaccessible-message',
          feedbackRevision: 0,
          generationRevision: 1,
          metadata: proposal('inaccessible-message', 'github@1', ['github'], 1, {
            feedbackRevision: 0,
            generationRevision: 1,
          }),
          sessionId: 'inaccessible-session',
          sourceFingerprint: 'github@1',
          threadId: 'inaccessible-thread',
          topicId: inaccessibleTopicId,
        }),
      () =>
        repository.failWriting({
          error: {
            code: 'UNDERSTANDING_WRITING_FAILED',
            message: 'understanding writing failed',
            operation: 'writing',
            provider: 'understanding',
            retryable: true,
          },
          feedbackRevision: 0,
          generationRevision: 1,
          sessionId: 'inaccessible-session',
          sourceFingerprint: 'github@1',
          topicId: inaccessibleTopicId,
        }),
      () =>
        repository.confirm({
          resultId: 'inaccessible-result',
          sessionId: 'inaccessible-session',
          topicId: inaccessibleTopicId,
        }),
      () => repository.removeForReset(inaccessibleTopicId),
    ];
    for (const inaccessibleTopicId of ['other-topic', 'workspace-topic']) {
      for (const operation of inaccessibleOperations(inaccessibleTopicId)) {
        await expect(operation()).rejects.toBeInstanceOf(UnderstandingResourceNotFoundError);
      }
    }

    await repository.removeForReset(topicId);
    await expect(repository.get(topicId)).resolves.toBeUndefined();
    await expect(
      db.select().from(threads).where(eq(threads.id, 'owned-thread')),
    ).resolves.toHaveLength(0);
  });
});
