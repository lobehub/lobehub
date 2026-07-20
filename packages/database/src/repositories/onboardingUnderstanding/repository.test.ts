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
  OnboardingUnderstandingRepository,
  StaleUnderstandingRevisionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from './repository';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-repository-user';
const otherUserId = 'understanding-repository-other';
const agentId = 'understanding-repository-agent';
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
): OnboardingUnderstandingMessageMetadata => ({
  analysis,
  diagnostics,
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

const insertAssistantMessage = async (id: string, threadId: string) => {
  await db.insert(messages).values({
    agentId,
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

  beforeEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(agents).values({ id: agentId, userId });
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
  });

  it('advances providers only through the active revision', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const revision = await repository.markProviderRunning(topicId, sessionId, 'github');

    expect(revision).toBe(1);
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

    const retryRevision = await repository.markProviderRunning(topicId, sessionId, 'gmail');
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

  it('claims a fingerprint once and rejects a stale proposal after more sources arrive', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const githubRevision = await repository.markProviderRunning(topicId, sessionId, 'github');
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
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });
    await insertAssistantMessage('stale-message', 'writing-thread');
    const duplicateClaim = await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'unused-thread',
      topicId,
    });
    expect(firstClaim).toEqual({ claimed: true, threadId: 'writing-thread' });
    expect(duplicateClaim).toEqual({ claimed: false, threadId: 'writing-thread' });

    const gmailRevision = await repository.markProviderRunning(topicId, sessionId, 'gmail');
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
        metadata: proposal('stale-result', 'github@1', ['github']),
        sessionId,
        sourceFingerprint: 'github@1',
        threadId: 'writing-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: false });

    await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1,gmail@1',
      threadId: 'writing-thread',
      topicId,
    });
    await insertAssistantMessage('current-message', 'writing-thread');

    await expect(
      repository.commitWriting({
        assistantMessageId: 'current-message',
        metadata: proposal('current-result', 'github@1,gmail@1', ['github', 'gmail']),
        sessionId,
        sourceFingerprint: 'github@1,gmail@1',
        threadId: 'writing-thread',
        topicId,
      }),
    ).resolves.toEqual({ published: true });

    const [message] = await db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, 'current-message'));
    expect(message.metadata).toEqual({
      keep: true,
      onboardingUnderstanding: proposal('current-result', 'github@1,gmail@1', ['github', 'gmail']),
    });
    expect((await repository.get(topicId))?.writing).toMatchObject({
      resultMessageId: 'current-message',
      sourceFingerprint: 'github@1,gmail@1',
      status: 'completed',
    });
  });

  it('confirms version one, then publishes one new Persona version per later fingerprint', async () => {
    await repository.initialize(topicId, sessionId, ['github', 'gmail']);
    const revision = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });
    await insertAssistantMessage('github-message', 'writing-thread');
    await repository.commitWriting({
      assistantMessageId: 'github-message',
      metadata: proposal('github-result', 'github@1', ['github']),
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

    const gmailRevision = await repository.markProviderRunning(topicId, sessionId, 'gmail');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'gmail',
      revision: gmailRevision,
      sessionId,
      succeededCount: 2,
      topicId,
    });
    await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1,gmail@1',
      threadId: 'writing-thread',
      topicId,
    });
    await insertAssistantMessage('combined-message', 'writing-thread');
    const combined = proposal('combined-result', 'github@1,gmail@1', ['github', 'gmail']);
    const published = await repository.commitWriting({
      assistantMessageId: 'combined-message',
      metadata: combined,
      sessionId,
      sourceFingerprint: combined.sourceFingerprint,
      threadId: 'writing-thread',
      topicId,
    });
    const replayed = await repository.commitWriting({
      assistantMessageId: 'combined-message',
      metadata: combined,
      sessionId,
      sourceFingerprint: combined.sourceFingerprint,
      threadId: 'writing-thread',
      topicId,
    });

    expect(published).toEqual({ personaVersion: 3, published: true });
    expect(replayed).toEqual({ personaVersion: 3, published: true });
    const persona = await personaModel.getLatestPersonaDocument();
    expect(persona).toMatchObject({ persona: analysis.personaProposal.content, version: 3 });
    expect(persona?.metadata).toMatchObject({
      onboardingUnderstanding: {
        composition: analysis.composition,
        diagnostics: { evidenceCount: 4, failedCount: 0, succeededCount: 2 },
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

  it('guards stale failures and preserves the valid proposal while a newer write fails', async () => {
    await repository.initialize(topicId, sessionId, ['github']);
    const firstRevision = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: firstRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });
    await insertAssistantMessage('valid-message', 'writing-thread');
    await repository.commitWriting({
      assistantMessageId: 'valid-message',
      metadata: proposal('valid-result', 'github@1', ['github']),
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });
    const secondRevision = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision: secondRevision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@2',
      threadId: 'writing-thread',
      topicId,
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
    const revision = await repository.markProviderRunning(topicId, sessionId, 'github');
    await repository.completeProvider({
      errors: [],
      failedCount: 0,
      providerId: 'github',
      revision,
      sessionId,
      succeededCount: 3,
      topicId,
    });
    await repository.claimWriting({
      agentId,
      sessionId,
      sourceFingerprint: 'github@1',
      threadId: 'writing-thread',
      topicId,
    });
    const removed = await repository.removeForReset(topicId);
    expect(removed?.id).toBe(sessionId);
    expect(await repository.get(topicId)).toBeUndefined();
    expect(await db.select().from(threads).where(eq(threads.id, 'writing-thread'))).toHaveLength(0);

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
