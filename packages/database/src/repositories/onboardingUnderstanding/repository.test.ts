// @vitest-environment node
import type {
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
        salience: 96,
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
): OnboardingUnderstandingMessageMetadata => ({
  analysis,
  diagnostics: { errors: [], evidenceCount: 4, failedCount: 0, succeededCount },
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
    await expect(
      repository.prepareWriting({
        agentId,
        sessionId,
        sourceFingerprint: fingerprint,
        threadId,
        topicId,
      }),
    ).resolves.toEqual({ ready: true, threadId });
    await insertAssistant(messageId, threadId);
    return repository.commitWriting({
      assistantMessageId: messageId,
      metadata: proposal(messageId, fingerprint, providers, providers.length === 1 ? 3 : 5),
      sessionId,
      sourceFingerprint: fingerprint,
      threadId,
      topicId,
    });
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

  it('publishes provider proposals and preserves a user edit across confirmation replay', async () => {
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
    ).resolves.toEqual({ personaVersion: 1 });
    const persona = new UserPersonaModel(db, userId);
    await persona.upsertPersona({ persona: 'User-edited persona', tagline: 'User-edited tagline' });
    await expect(
      repository.confirm({ resultId: 'github-result', sessionId, topicId }),
    ).resolves.toEqual({ personaVersion: 2 });
    await expect(persona.getLatestPersonaDocument()).resolves.toMatchObject({
      persona: 'User-edited persona',
      tagline: 'User-edited tagline',
      version: 2,
    });

    await completeProvider('gmail', 2);
    const failedBeforePrepare = await repository.failWriting({
      error: {
        code: 'UNDERSTANDING_WRITING_FAILED',
        message: 'understanding writing failed',
        operation: 'writing',
        provider: 'understanding',
        retryable: true,
      },
      sessionId,
      sourceFingerprint: 'github@1,gmail@1',
      topicId,
    });
    expect(failedBeforePrepare.writing).toMatchObject({
      resultMessageId: 'github-result',
      sourceFingerprint: 'github@1,gmail@1',
      status: 'failed',
    });
    await expect(
      publish('github@1,gmail@1', ['github', 'gmail'], 'combined-result', 'combined-thread'),
    ).resolves.toEqual({ personaVersion: 3, published: true });
    await expect(persona.getLatestPersonaDocument()).resolves.toMatchObject({
      persona: analysis.personaProposal.content,
      version: 3,
    });
    expect(
      await db
        .select()
        .from(userPersonaDocumentHistories)
        .where(eq(userPersonaDocumentHistories.userId, userId)),
    ).toHaveLength(2);
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
    ).resolves.toEqual({ ready: false, threadId: 'stale-thread' });
    await expect(
      repository.commitWriting({
        assistantMessageId: 'missing-stale-result',
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
    ).resolves.toEqual({ ready: true, threadId: 'owned-thread' });
    await insertAssistant('wrong-agent-message', 'owned-thread', { agent: otherAgentId });
    await expect(
      repository.commitWriting({
        assistantMessageId: 'wrong-agent-message',
        metadata: proposal('wrong-agent-message', 'github@1', ['github'], 3),
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
          metadata: proposal('inaccessible-message', 'github@1', ['github'], 1),
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
