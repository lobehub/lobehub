import type {
  CollectionError,
  ConfirmOnboardingUnderstandingInput,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingProviderState,
} from '@lobechat/types';
import {
  CollectionDiagnosticsSchema,
  CollectionDiagnosticsSummarySchema,
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import {
  lockUserPersonaOwner,
  upsertUserPersonaInTransaction,
} from '../../models/userMemory/persona';
import { messages, threads, topics, userPersonaDocuments } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { getUnderstandingSourceFingerprint } from './fingerprint';

export { getUnderstandingSourceFingerprint } from './fingerprint';

export class UnderstandingSessionNotFoundError extends Error {
  constructor(topicId: string) {
    super(`No active onboarding Understanding session for topic: ${topicId}`);
    this.name = 'UnderstandingSessionNotFoundError';
  }
}

export class StaleUnderstandingSessionError extends Error {
  constructor(sessionId: string) {
    super(`Onboarding Understanding session is no longer active: ${sessionId}`);
    this.name = 'StaleUnderstandingSessionError';
  }
}

export class StaleUnderstandingRevisionError extends Error {
  constructor(scope: string, reference: number | string) {
    super(`Onboarding Understanding ${scope} is no longer active: ${reference}`);
    this.name = 'StaleUnderstandingRevisionError';
  }
}

export class InvalidUnderstandingSessionError extends Error {
  constructor(cause: unknown) {
    super('Onboarding Understanding session manifest is invalid', { cause });
    this.name = 'InvalidUnderstandingSessionError';
  }
}

export class UnderstandingResourceNotFoundError extends Error {
  constructor(resource: 'result' | 'session' | 'topic') {
    super(`Onboarding Understanding ${resource} was not found`);
    this.name = 'UnderstandingResourceNotFoundError';
  }
}

export class UnderstandingPreconditionError extends Error {
  constructor(reason: 'result_not_confirmable' | 'source_not_retryable' | 'writing_not_active') {
    super(`Onboarding Understanding precondition failed: ${reason}`);
    this.name = 'UnderstandingPreconditionError';
  }
}

interface ProviderMutationInput {
  errors: CollectionError[];
  failedCount: number;
  providerId: string;
  revision: number;
  sessionId: string;
  succeededCount: number;
  topicId: string;
}

interface ClaimWritingInput {
  sessionId: string;
  sourceFingerprint: string;
  topicId: string;
}

interface EnsureWritingThreadInput extends ClaimWritingInput {
  agentId: string;
  threadId: string;
}

interface CommitWritingInput {
  assistantMessageId: string;
  metadata: OnboardingUnderstandingMessageMetadata;
  sessionId: string;
  sourceFingerprint: string;
  threadId: string;
  topicId: string;
}

interface FailWritingInput {
  error: CollectionError;
  sessionId: string;
  sourceFingerprint: string;
  topicId: string;
}

interface ProviderClaim {
  claimed: boolean;
  revision: number;
}

const PROVIDER_ID_PATTERN = /^[\w-]+$/;

const assertProviderId = (providerId: string) => {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new InvalidUnderstandingSessionError(`Invalid provider id: ${providerId}`);
  }
};

const topicOwnership = (topicId: string, userId: string) =>
  and(eq(topics.id, topicId), eq(topics.userId, userId), isNull(topics.workspaceId));

const threadOwnership = (userId: string) =>
  and(eq(threads.userId, userId), isNull(threads.workspaceId));

const messageOwnership = (userId: string) =>
  and(eq(messages.userId, userId), isNull(messages.workspaceId));

const parseSession = (value: unknown): OnboardingUnderstandingSession => {
  let session: OnboardingUnderstandingSession;
  try {
    session = OnboardingUnderstandingSessionSchema.parse(value);
  } catch (error) {
    throw new InvalidUnderstandingSessionError(error);
  }
  Object.keys(session.sources).forEach(assertProviderId);
  return session;
};

const initialProviderState = (): UnderstandingProviderState => ({
  errors: [],
  failedCount: 0,
  revision: 0,
  status: 'pending',
  succeededCount: 0,
});

const normalizeProposalProvenance = (
  session: OnboardingUnderstandingSession,
  proposal: OnboardingUnderstandingMessageMetadata,
) => {
  const completedSources = Object.entries(session.sources)
    .filter(([, source]) => source.status === 'completed')
    .sort(([left], [right]) => left.localeCompare(right));
  const providerIds = completedSources.map(([providerId]) => providerId);
  if (!isEqual(proposal.providers, providerIds)) {
    throw new Error('Understanding proposal providers do not match completed sources');
  }

  const terminalSources = Object.entries(session.sources)
    .filter(([, source]) => source.status === 'completed' || source.status === 'failed')
    .sort(([left], [right]) => left.localeCompare(right));
  const succeededCount = terminalSources.reduce(
    (total, [, source]) => total + source.succeededCount,
    0,
  );
  const failedCount = terminalSources.reduce((total, [, source]) => total + source.failedCount, 0);
  const errors = terminalSources
    .flatMap(([, source]) => source.errors)
    .slice(-MAX_COLLECTION_ERRORS);
  const diagnostics = CollectionDiagnosticsSchema.parse({
    errors,
    evidenceCount: proposal.diagnostics.evidenceCount,
    failedCount,
    succeededCount,
  });
  return OnboardingUnderstandingMessageMetadataSchema.parse({ ...proposal, diagnostics });
};

const getStoredProposal = (metadata: unknown) => {
  if (!isPlainRecord(metadata)) return;
  const parsed = OnboardingUnderstandingMessageMetadataSchema.safeParse(
    metadata.onboardingUnderstanding,
  );
  return parsed.success ? parsed.data : undefined;
};

const hasPersonaProvenance = (metadata: unknown, sessionId: string, sourceFingerprint: string) => {
  const provenance = isPlainRecord(metadata) ? metadata.onboardingUnderstanding : undefined;
  return (
    isPlainRecord(provenance) &&
    provenance.sessionId === sessionId &&
    provenance.sourceFingerprint === sourceFingerprint
  );
};

const lockOwnedTopic = async (tx: Transaction, userId: string, topicId: string) => {
  const [topic] = await tx
    .select({ metadata: topics.metadata })
    .from(topics)
    .where(topicOwnership(topicId, userId))
    .for('update');
  if (!topic) throw new UnderstandingResourceNotFoundError('topic');
  return topic;
};

const requireSession = (
  topicId: string,
  expectedSessionId: string,
  value: unknown,
): OnboardingUnderstandingSession => {
  if (!value) throw new UnderstandingSessionNotFoundError(topicId);
  const session = parseSession(value);
  if (session.id !== expectedSessionId) {
    throw new StaleUnderstandingSessionError(expectedSessionId);
  }
  return session;
};

const updateTopicSession = async (
  tx: Transaction,
  userId: string,
  topicId: string,
  topicMetadata: NonNullable<(typeof topics.$inferSelect)['metadata']>,
  session: OnboardingUnderstandingSession | undefined,
) => {
  const onboardingSession = topicMetadata.onboardingSession;
  if (!onboardingSession) throw new UnderstandingSessionNotFoundError(topicId);
  const parsed = session ? parseSession(session) : undefined;

  await tx
    .update(topics)
    .set({
      metadata: {
        ...topicMetadata,
        onboardingSession: { ...onboardingSession, understanding: parsed },
      },
      updatedAt: new Date(),
    })
    .where(topicOwnership(topicId, userId));
};

export class OnboardingUnderstandingRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  get = async (topicId: string): Promise<OnboardingUnderstandingSession | undefined> => {
    const [topic] = await this.db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(topicOwnership(topicId, this.userId));
    const persisted = topic?.metadata?.onboardingSession?.understanding;
    return persisted ? parseSession(persisted) : undefined;
  };

  initialize = async (
    topicId: string,
    sessionId: string,
    providerIds: string[],
  ): Promise<OnboardingUnderstandingSession> =>
    this.db.transaction(async (tx) => {
      providerIds.forEach(assertProviderId);
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const onboardingSession = topic.metadata?.onboardingSession;
      if (!onboardingSession) throw new UnderstandingSessionNotFoundError(topicId);
      if (onboardingSession.understanding) return parseSession(onboardingSession.understanding);

      const sources = Object.fromEntries(
        [...new Set(providerIds)].map((providerId) => [providerId, initialProviderState()]),
      );
      const session = parseSession({ id: sessionId, sources });
      await updateTopicSession(tx, this.userId, topicId, topic.metadata, session);
      return session;
    });

  /**
   * Claim this provider in its own durable Upstash context.run step. Upstash replays the winning
   * result into the separate collection/Redis step, so retries never recollect a running revision.
   */
  markProviderRunning = async (
    topicId: string,
    sessionId: string,
    providerId: string,
  ): Promise<ProviderClaim> =>
    this.db.transaction(async (tx) => {
      assertProviderId(providerId);
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const session = requireSession(
        topicId,
        sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      const provider = session.sources[providerId];
      if (!provider) throw new UnderstandingResourceNotFoundError('session');
      if (provider.status === 'running') return { claimed: false, revision: provider.revision };

      const revision = provider.revision + 1;
      const next = parseSession({
        ...session,
        sources: {
          ...session.sources,
          [providerId]: {
            ...provider,
            completedAt: undefined,
            errors: [],
            failedCount: 0,
            revision,
            status: 'running',
            succeededCount: 0,
          },
        },
      });
      await updateTopicSession(tx, this.userId, topicId, topic.metadata!, next);
      return { claimed: true, revision };
    });

  completeProvider = (input: ProviderMutationInput): Promise<OnboardingUnderstandingSession> =>
    this.finishProvider(input, 'completed');

  failProvider = (input: ProviderMutationInput): Promise<OnboardingUnderstandingSession> =>
    this.finishProvider(input, 'failed');

  claimWriting = async ({
    sessionId,
    sourceFingerprint,
    topicId,
  }: ClaimWritingInput): Promise<{ claimed: boolean }> =>
    this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const session = requireSession(
        topicId,
        sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      if (getUnderstandingSourceFingerprint(session) !== sourceFingerprint) {
        throw new StaleUnderstandingRevisionError('writing fingerprint', sourceFingerprint);
      }
      if (session.writing?.sourceFingerprint === sourceFingerprint) {
        return { claimed: false };
      }
      const next = parseSession({
        ...session,
        writing: {
          resultMessageId: session.writing?.resultMessageId,
          sourceFingerprint,
          status: 'running',
          updatedAt: new Date().toISOString(),
        },
      });
      await updateTopicSession(tx, this.userId, topicId, topic.metadata!, next);
      return { claimed: true };
    });

  ensureWritingThread = async ({
    agentId,
    sessionId,
    sourceFingerprint,
    threadId,
    topicId,
  }: EnsureWritingThreadInput): Promise<{ threadId: string }> =>
    this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const session = requireSession(
        topicId,
        sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      if (
        session.writing?.sourceFingerprint !== sourceFingerprint ||
        getUnderstandingSourceFingerprint(session) !== sourceFingerprint
      ) {
        throw new StaleUnderstandingRevisionError('writing fingerprint', sourceFingerprint);
      }
      if (session.writing.status !== 'running') {
        throw new UnderstandingPreconditionError('writing_not_active');
      }

      const [writingThread] = await tx
        .select()
        .from(threads)
        .where(and(eq(threads.id, threadId), threadOwnership(this.userId)))
        .for('update');
      if (writingThread) {
        if (
          writingThread.agentId !== agentId ||
          writingThread.topicId !== topicId ||
          writingThread.type !== ThreadType.Isolation ||
          writingThread.metadata?.onboardingUnderstanding?.kind !== 'writing'
        ) {
          throw new Error(`Invalid Understanding writing thread: ${threadId}`);
        }
        return { threadId };
      }

      const [occupied] = await tx
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, threadId));
      if (occupied) {
        throw new Error(`Understanding writing thread identity is occupied: ${threadId}`);
      }
      await tx.insert(threads).values({
        agentId,
        id: threadId,
        metadata: { onboardingUnderstanding: { kind: 'writing' } },
        status: ThreadStatus.Pending,
        topicId,
        type: ThreadType.Isolation,
        userId: this.userId,
      });
      return { threadId };
    });

  commitWriting = async ({
    assistantMessageId,
    metadata,
    sessionId,
    sourceFingerprint,
    threadId,
    topicId,
  }: CommitWritingInput): Promise<{ personaVersion?: number; published: boolean }> => {
    const requestedProposal = OnboardingUnderstandingMessageMetadataSchema.parse(metadata);
    if (requestedProposal.sourceFingerprint !== sourceFingerprint) {
      throw new Error('Understanding proposal fingerprint does not match the writing claim');
    }

    return this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const session = requireSession(
        topicId,
        sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      if (
        session.writing?.sourceFingerprint !== sourceFingerprint ||
        getUnderstandingSourceFingerprint(session) !== sourceFingerprint
      ) {
        return { published: false };
      }
      const writingThread = await this.lockWritingThread(tx, topicId, threadId);
      const [message] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, assistantMessageId), messageOwnership(this.userId)))
        .for('update');
      if (
        !message ||
        message.agentId !== writingThread.agentId ||
        message.role !== 'assistant' ||
        message.topicId !== topicId ||
        message.threadId !== writingThread.id
      ) {
        throw new UnderstandingResourceNotFoundError('result');
      }

      if (session.writing.status === 'completed') {
        const stored = getStoredProposal(message.metadata);
        if (
          session.writing.resultMessageId !== assistantMessageId ||
          !stored ||
          stored.sourceFingerprint !== sourceFingerprint ||
          writingThread.status !== ThreadStatus.Completed
        ) {
          throw new UnderstandingPreconditionError('writing_not_active');
        }
        return {
          personaVersion: session.confirmedAt
            ? await this.getPersonaVersionForFingerprint(tx, sessionId, sourceFingerprint)
            : undefined,
          published: true,
        };
      }
      if (session.writing.status !== 'running') {
        throw new UnderstandingPreconditionError('writing_not_active');
      }

      const proposal = normalizeProposalProvenance(session, requestedProposal);
      const existingMetadata = isPlainRecord(message.metadata) ? message.metadata : {};
      await tx
        .update(messages)
        .set({
          metadata: { ...existingMetadata, onboardingUnderstanding: proposal },
          updatedAt: new Date(),
        })
        .where(and(eq(messages.id, assistantMessageId), messageOwnership(this.userId)));
      await tx
        .update(threads)
        .set({ status: ThreadStatus.Completed, updatedAt: new Date() })
        .where(and(eq(threads.id, writingThread.id), threadOwnership(this.userId)));

      const personaVersion = session.confirmedAt
        ? await this.writePersona(tx, sessionId, proposal)
        : undefined;
      const next = parseSession({
        ...session,
        writing: {
          resultMessageId: assistantMessageId,
          sourceFingerprint,
          status: 'completed',
          updatedAt: new Date().toISOString(),
        },
      });
      await updateTopicSession(tx, this.userId, topicId, topic.metadata!, next);
      return { personaVersion, published: true };
    });
  };

  failWriting = async ({
    error,
    sessionId,
    sourceFingerprint,
    topicId,
  }: FailWritingInput): Promise<OnboardingUnderstandingSession> =>
    this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const session = requireSession(
        topicId,
        sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      if (
        session.writing?.sourceFingerprint !== sourceFingerprint ||
        session.writing.status !== 'running'
      ) {
        return session;
      }

      const next = parseSession({
        ...session,
        writing: {
          error,
          resultMessageId: session.writing.resultMessageId,
          sourceFingerprint,
          status: 'failed',
          updatedAt: new Date().toISOString(),
        },
      });
      await updateTopicSession(tx, this.userId, topicId, topic.metadata!, next);
      return next;
    });

  confirm = async (
    input: ConfirmOnboardingUnderstandingInput,
  ): Promise<{ personaVersion: number }> =>
    this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, input.topicId);
      const session = requireSession(
        input.topicId,
        input.sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      if (!session.writing?.resultMessageId) {
        throw new UnderstandingPreconditionError('result_not_confirmable');
      }

      const [message] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, session.writing.resultMessageId), messageOwnership(this.userId)))
        .for('update');
      const proposal = getStoredProposal(message?.metadata);
      if (
        !message ||
        message.role !== 'assistant' ||
        message.topicId !== input.topicId ||
        proposal?.resultId !== input.resultId
      ) {
        throw new UnderstandingResourceNotFoundError('result');
      }
      if (!message.threadId) throw new UnderstandingResourceNotFoundError('result');
      const writingThread = await this.lockWritingThread(tx, input.topicId, message.threadId);
      if (message.agentId !== writingThread.agentId) {
        throw new UnderstandingResourceNotFoundError('result');
      }

      const personaVersion = await this.writePersona(tx, session.id, proposal);
      if (!session.confirmedAt) {
        await updateTopicSession(tx, this.userId, input.topicId, topic.metadata!, {
          ...session,
          confirmedAt: new Date().toISOString(),
        });
      }
      return { personaVersion };
    });

  removeForReset = async (topicId: string): Promise<OnboardingUnderstandingSession | undefined> =>
    this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, topicId);
      const persisted = topic.metadata?.onboardingSession?.understanding;
      if (!persisted) return;
      const session = parseSession(persisted);

      const writingThreadIds = (
        await tx
          .select({ id: threads.id, metadata: threads.metadata })
          .from(threads)
          .where(and(eq(threads.topicId, topicId), threadOwnership(this.userId)))
          .for('update')
      )
        .filter(({ metadata }) => metadata?.onboardingUnderstanding?.kind === 'writing')
        .map(({ id }) => id);
      if (writingThreadIds.length > 0) {
        await tx
          .delete(threads)
          .where(and(inArray(threads.id, writingThreadIds), threadOwnership(this.userId)));
      }
      await updateTopicSession(tx, this.userId, topicId, topic.metadata!, undefined);
      return session;
    });

  private finishProvider = async (
    input: ProviderMutationInput,
    status: 'completed' | 'failed',
  ): Promise<OnboardingUnderstandingSession> => {
    assertProviderId(input.providerId);
    const errors = input.errors.slice(-MAX_COLLECTION_ERRORS);
    return this.db.transaction(async (tx) => {
      const topic = await lockOwnedTopic(tx, this.userId, input.topicId);
      const session = requireSession(
        input.topicId,
        input.sessionId,
        topic.metadata?.onboardingSession?.understanding,
      );
      const provider = session.sources[input.providerId];
      if (!provider) throw new UnderstandingResourceNotFoundError('session');
      const expected = {
        ...provider,
        completedAt: provider.completedAt,
        errors,
        failedCount: input.failedCount,
        status,
        succeededCount: input.succeededCount,
      };
      if (provider.revision !== input.revision || provider.status !== 'running') {
        if (provider.revision === input.revision && isEqual(provider, expected)) return session;
        throw new StaleUnderstandingRevisionError(input.providerId, input.revision);
      }

      const next = parseSession({
        ...session,
        sources: {
          ...session.sources,
          [input.providerId]: {
            ...expected,
            completedAt: new Date().toISOString(),
          },
        },
      });
      await updateTopicSession(tx, this.userId, input.topicId, topic.metadata!, next);
      return next;
    });
  };

  private lockWritingThread = async (tx: Transaction, topicId: string, threadId: string) => {
    const [thread] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), threadOwnership(this.userId)))
      .for('update');
    if (
      !thread ||
      thread.topicId !== topicId ||
      thread.type !== ThreadType.Isolation ||
      thread.metadata?.onboardingUnderstanding?.kind !== 'writing'
    ) {
      throw new UnderstandingResourceNotFoundError('result');
    }
    return thread;
  };

  private getPersonaVersionForFingerprint = async (
    tx: Transaction,
    sessionId: string,
    sourceFingerprint: string,
  ) => {
    const [persona] = await tx
      .select({ metadata: userPersonaDocuments.metadata, version: userPersonaDocuments.version })
      .from(userPersonaDocuments)
      .where(
        and(
          eq(userPersonaDocuments.userId, this.userId),
          eq(userPersonaDocuments.profile, 'default'),
        ),
      )
      .orderBy(desc(userPersonaDocuments.version))
      .for('update');
    return hasPersonaProvenance(persona?.metadata, sessionId, sourceFingerprint)
      ? persona?.version
      : undefined;
  };

  private writePersona = async (
    tx: Transaction,
    sessionId: string,
    proposal: OnboardingUnderstandingMessageMetadata,
  ): Promise<number> => {
    await lockUserPersonaOwner(tx, this.userId);
    const [current] = await tx
      .select({ metadata: userPersonaDocuments.metadata, version: userPersonaDocuments.version })
      .from(userPersonaDocuments)
      .where(
        and(
          eq(userPersonaDocuments.userId, this.userId),
          eq(userPersonaDocuments.profile, 'default'),
        ),
      )
      .for('update');
    if (current && hasPersonaProvenance(current.metadata, sessionId, proposal.sourceFingerprint)) {
      return current.version;
    }
    const currentMetadata = isPlainRecord(current?.metadata) ? current.metadata : {};
    const { analysis, diagnostics, providers, sourceFingerprint } = proposal;
    const result = await upsertUserPersonaInTransaction(tx, this.userId, {
      metadata: {
        ...currentMetadata,
        onboardingUnderstanding: {
          composition: analysis.composition,
          diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics),
          profile: analysis.profile,
          providers,
          sessionId,
          sourceFingerprint,
        },
      },
      persona: analysis.personaProposal.content,
      reasoning: analysis.personaProposal.reasoning,
      tagline: analysis.personaProposal.tagline,
    });
    return result.document.version;
  };
}
