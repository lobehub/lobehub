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
  MAX_COLLECTION_COUNT,
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  getUserPersonaForUpdateInTransaction,
  upsertUserPersonaInTransaction,
} from '../../models/userMemory/persona';
import { messages, threads, topics } from '../../schemas';
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

interface ExpireProviderContextsInput {
  providers: Array<{ providerId: string; revision: number }>;
  sessionId: string;
  sourceFingerprint: string;
  topicId: string;
}

interface PrepareWritingInput {
  agentId: string;
  sessionId: string;
  sourceFingerprint: string;
  threadId: string;
  topicId: string;
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

interface SessionMutation<Result> {
  nextSession: OnboardingUnderstandingSession | undefined;
  result: Result;
  write: boolean;
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

const expiredContextError = (provider: string): CollectionError => ({
  code: 'UNDERSTANDING_PROVIDER_CONTEXT_EXPIRED',
  message: `${provider} context expired`,
  operation: 'context',
  provider,
  retryable: true,
});

const requireSession = (
  topicId: string,
  expectedSessionId: string,
  session: OnboardingUnderstandingSession | undefined,
) => {
  if (!session) throw new UnderstandingSessionNotFoundError(topicId);
  if (session.id !== expectedSessionId) throw new StaleUnderstandingSessionError(expectedSessionId);
  return session;
};

const getStoredProposal = (metadata: unknown) => {
  if (!isPlainRecord(metadata)) return;
  const parsed = OnboardingUnderstandingMessageMetadataSchema.safeParse(
    metadata.onboardingUnderstanding,
  );
  return parsed.success ? parsed.data : undefined;
};

const normalizeProposal = (
  session: OnboardingUnderstandingSession,
  proposal: OnboardingUnderstandingMessageMetadata,
) => {
  const completedProviders = Object.entries(session.sources)
    .filter(([, source]) => source.status === 'completed')
    .map(([providerId]) => providerId)
    .sort();
  if (
    proposal.providers.length !== completedProviders.length ||
    proposal.providers.some((providerId, index) => providerId !== completedProviders[index])
  ) {
    throw new Error('Understanding proposal providers do not match completed sources');
  }

  const terminalSources = Object.values(session.sources).filter(
    ({ status }) => status === 'completed' || status === 'failed',
  );
  return OnboardingUnderstandingMessageMetadataSchema.parse({
    ...proposal,
    diagnostics: CollectionDiagnosticsSchema.parse({
      errors: terminalSources.flatMap(({ errors }) => errors).slice(-MAX_COLLECTION_ERRORS),
      evidenceCount: proposal.diagnostics.evidenceCount,
      failedCount: terminalSources.reduce((total, source) => total + source.failedCount, 0),
      succeededCount: terminalSources.reduce((total, source) => total + source.succeededCount, 0),
    }),
  });
};

const mutateTopicSession = async <Result>(
  tx: Transaction,
  userId: string,
  topicId: string,
  mutate: (
    session: OnboardingUnderstandingSession | undefined,
  ) => Promise<SessionMutation<Result>> | SessionMutation<Result>,
): Promise<Result> => {
  const [topic] = await tx
    .select({ metadata: topics.metadata })
    .from(topics)
    .where(topicOwnership(topicId, userId))
    .for('update');
  if (!topic) throw new UnderstandingResourceNotFoundError('topic');
  const onboardingSession = topic.metadata?.onboardingSession;
  if (!onboardingSession) throw new UnderstandingSessionNotFoundError(topicId);
  const persisted = onboardingSession.understanding;
  const session = persisted ? parseSession(persisted) : undefined;
  const mutation = await mutate(session);

  if (mutation.write) {
    await tx
      .update(topics)
      .set({
        metadata: {
          ...topic.metadata,
          onboardingSession: {
            ...onboardingSession,
            understanding: mutation.nextSession
              ? parseSession(mutation.nextSession)
              : mutation.nextSession,
          },
        },
        updatedAt: new Date(),
      })
      .where(topicOwnership(topicId, userId));
  }
  return mutation.result;
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
    this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, (existing) => {
        providerIds.forEach(assertProviderId);
        if (existing) return { nextSession: existing, result: existing, write: false };
        const sources = Object.fromEntries(
          [...new Set(providerIds)].map((providerId) => [providerId, initialProviderState()]),
        );
        const session = parseSession({ id: sessionId, sources });
        return { nextSession: session, result: session, write: true };
      }),
    );

  markProviderRunning = async (
    topicId: string,
    sessionId: string,
    providerId: string,
  ): Promise<{ revision: number }> => {
    assertProviderId(providerId);
    return this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, (persisted) => {
        const session = requireSession(topicId, sessionId, persisted);
        const provider = session.sources[providerId];
        if (!provider) throw new UnderstandingResourceNotFoundError('session');
        if (provider.status !== 'pending' && provider.status !== 'failed') {
          throw new UnderstandingPreconditionError('source_not_retryable');
        }
        const revision = provider.revision + 1;
        const nextSession = parseSession({
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
        return { nextSession, result: { revision }, write: true };
      }),
    );
  };

  completeProvider = (input: ProviderMutationInput): Promise<OnboardingUnderstandingSession> =>
    this.finishProvider(input, 'completed');

  failProvider = (input: ProviderMutationInput): Promise<OnboardingUnderstandingSession> =>
    this.finishProvider(input, 'failed');

  expireProviderContexts = async ({
    providers,
    sessionId,
    sourceFingerprint,
    topicId,
  }: ExpireProviderContextsInput): Promise<OnboardingUnderstandingSession> => {
    providers.forEach(({ providerId }) => assertProviderId(providerId));
    if (new Set(providers.map(({ providerId }) => providerId)).size !== providers.length) {
      throw new InvalidUnderstandingSessionError('Expired provider contexts must be unique');
    }
    return this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, (persisted) => {
        const session = requireSession(topicId, sessionId, persisted);
        if (getUnderstandingSourceFingerprint(session) !== sourceFingerprint) {
          return { nextSession: session, result: session, write: false };
        }
        if (
          providers.some(({ providerId, revision }) => {
            const provider = session.sources[providerId];
            return !provider || provider.status !== 'completed' || provider.revision !== revision;
          })
        ) {
          return { nextSession: session, result: session, write: false };
        }
        const now = new Date().toISOString();
        const sources = { ...session.sources };
        for (const { providerId } of providers) {
          const provider = sources[providerId];
          const error = expiredContextError(providerId);
          sources[providerId] = {
            ...provider,
            completedAt: now,
            errors: [...provider.errors, error].slice(-MAX_COLLECTION_ERRORS),
            failedCount: Math.min(MAX_COLLECTION_COUNT, provider.failedCount + 1),
            status: 'failed',
          };
        }
        const nextSession = parseSession({
          ...session,
          sources,
          writing: {
            error: expiredContextError('understanding'),
            resultMessageId: session.writing?.resultMessageId,
            sourceFingerprint,
            status: 'failed',
            updatedAt: now,
          },
        });
        return { nextSession, result: nextSession, write: true };
      }),
    );
  };

  prepareWriting = async ({
    agentId,
    sessionId,
    sourceFingerprint,
    threadId,
    topicId,
  }: PrepareWritingInput): Promise<{ ready: boolean; threadId: string }> =>
    this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, async (persisted) => {
        const session = requireSession(topicId, sessionId, persisted);
        if (
          getUnderstandingSourceFingerprint(session) !== sourceFingerprint ||
          (session.writing?.sourceFingerprint === sourceFingerprint &&
            session.writing.status === 'completed')
        ) {
          return {
            nextSession: session,
            result: { ready: false as boolean, threadId },
            write: false,
          };
        }

        await tx
          .insert(threads)
          .values({
            agentId,
            id: threadId,
            metadata: { onboardingUnderstanding: { kind: 'writing' } },
            status: ThreadStatus.Pending,
            topicId,
            type: ThreadType.Isolation,
            userId: this.userId,
          })
          .onConflictDoNothing({ target: threads.id });
        const [thread] = await tx
          .select()
          .from(threads)
          .where(and(eq(threads.id, threadId), threadOwnership(this.userId)))
          .for('update');
        if (
          !thread ||
          thread.agentId !== agentId ||
          thread.topicId !== topicId ||
          thread.type !== ThreadType.Isolation ||
          thread.metadata?.onboardingUnderstanding?.kind !== 'writing'
        ) {
          throw new UnderstandingResourceNotFoundError('result');
        }

        const nextSession = parseSession({
          ...session,
          writing: {
            resultMessageId: session.writing?.resultMessageId,
            sourceFingerprint,
            status: 'running',
            updatedAt: new Date().toISOString(),
          },
        });
        return {
          nextSession,
          result: { ready: true as boolean, threadId },
          write: true,
        };
      }),
    );

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
      throw new Error('Understanding proposal fingerprint does not match the writing state');
    }

    return this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, async (persisted) => {
        const session = requireSession(topicId, sessionId, persisted);
        if (
          getUnderstandingSourceFingerprint(session) !== sourceFingerprint ||
          session.writing?.sourceFingerprint !== sourceFingerprint
        ) {
          return {
            nextSession: session,
            result: { published: false as boolean },
            write: false,
          };
        }
        if (session.writing.status !== 'running') {
          throw new UnderstandingPreconditionError('writing_not_active');
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

        const proposal = normalizeProposal(session, requestedProposal);
        const messageMetadata = isPlainRecord(message.metadata) ? message.metadata : {};
        await tx
          .update(messages)
          .set({
            metadata: { ...messageMetadata, onboardingUnderstanding: proposal },
            updatedAt: new Date(),
          })
          .where(and(eq(messages.id, assistantMessageId), messageOwnership(this.userId)));
        await tx
          .update(threads)
          .set({ status: ThreadStatus.Completed, updatedAt: new Date() })
          .where(and(eq(threads.id, threadId), threadOwnership(this.userId)));

        const personaVersion = session.confirmedAt
          ? await this.writePersona(tx, sessionId, proposal)
          : undefined;
        const nextSession = parseSession({
          ...session,
          writing: {
            resultMessageId: assistantMessageId,
            sourceFingerprint,
            status: 'completed',
            updatedAt: new Date().toISOString(),
          },
        });
        return {
          nextSession,
          result: {
            ...(personaVersion ? { personaVersion } : {}),
            published: true as boolean,
          },
          write: true,
        };
      }),
    );
  };

  failWriting = async ({
    error,
    sessionId,
    sourceFingerprint,
    topicId,
  }: FailWritingInput): Promise<OnboardingUnderstandingSession> =>
    this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, (persisted) => {
        const session = requireSession(topicId, sessionId, persisted);
        if (
          getUnderstandingSourceFingerprint(session) !== sourceFingerprint ||
          (session.writing?.sourceFingerprint === sourceFingerprint &&
            session.writing.status !== 'running')
        ) {
          return { nextSession: session, result: session, write: false };
        }
        const nextSession = parseSession({
          ...session,
          writing: {
            error,
            resultMessageId: session.writing?.resultMessageId,
            sourceFingerprint,
            status: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        return { nextSession, result: nextSession, write: true };
      }),
    );

  confirm = async (
    input: ConfirmOnboardingUnderstandingInput,
  ): Promise<{ personaVersion: number }> =>
    this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, input.topicId, async (persisted) => {
        const session = requireSession(input.topicId, input.sessionId, persisted);
        if (!session.writing?.resultMessageId || session.writing.status !== 'completed') {
          throw new UnderstandingPreconditionError('result_not_confirmable');
        }
        const [message] = await tx
          .select()
          .from(messages)
          .where(
            and(eq(messages.id, session.writing.resultMessageId), messageOwnership(this.userId)),
          )
          .for('update');
        const proposal = getStoredProposal(message?.metadata);
        if (
          !message ||
          message.role !== 'assistant' ||
          message.topicId !== input.topicId ||
          proposal?.resultId !== input.resultId ||
          !message.threadId
        ) {
          throw new UnderstandingResourceNotFoundError('result');
        }
        const writingThread = await this.lockWritingThread(tx, input.topicId, message.threadId);
        if (message.agentId !== writingThread.agentId) {
          throw new UnderstandingResourceNotFoundError('result');
        }

        if (session.confirmedAt) {
          const current = await getUserPersonaForUpdateInTransaction(tx, this.userId);
          if (!current) throw new UnderstandingPreconditionError('result_not_confirmable');
          return {
            nextSession: session,
            result: { personaVersion: current.version },
            write: false,
          };
        }

        const personaVersion = await this.writePersona(tx, session.id, proposal);
        const nextSession = parseSession({ ...session, confirmedAt: new Date().toISOString() });
        return { nextSession, result: { personaVersion }, write: true };
      }),
    );

  removeForReset = async (topicId: string): Promise<OnboardingUnderstandingSession | undefined> =>
    this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, topicId, async (session) => {
        if (!session) return { nextSession: undefined, result: undefined, write: false };
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
        return { nextSession: undefined, result: session, write: true };
      }),
    );

  private finishProvider = async (
    input: ProviderMutationInput,
    status: 'completed' | 'failed',
  ): Promise<OnboardingUnderstandingSession> => {
    assertProviderId(input.providerId);
    const errors = input.errors.slice(-MAX_COLLECTION_ERRORS);
    return this.db.transaction((tx) =>
      mutateTopicSession(tx, this.userId, input.topicId, (persisted) => {
        const session = requireSession(input.topicId, input.sessionId, persisted);
        const provider = session.sources[input.providerId];
        if (!provider) throw new UnderstandingResourceNotFoundError('session');
        if (provider.revision !== input.revision || provider.status !== 'running') {
          throw new StaleUnderstandingRevisionError(input.providerId, input.revision);
        }
        const nextSession = parseSession({
          ...session,
          sources: {
            ...session.sources,
            [input.providerId]: {
              ...provider,
              completedAt: new Date().toISOString(),
              errors,
              failedCount: input.failedCount,
              status,
              succeededCount: input.succeededCount,
            },
          },
        });
        return { nextSession, result: nextSession, write: true };
      }),
    );
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

  private writePersona = async (
    tx: Transaction,
    sessionId: string,
    proposal: OnboardingUnderstandingMessageMetadata,
  ) => {
    const { analysis, diagnostics, providers, sourceFingerprint } = proposal;
    const result = await upsertUserPersonaInTransaction(tx, this.userId, {
      metadataPatch: {
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
