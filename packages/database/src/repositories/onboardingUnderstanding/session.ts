import type { OnboardingUnderstandingSession } from '@lobechat/types';
import {
  OnboardingUnderstandingSessionSchema,
  projectOnboardingUnderstandingSessionStatus,
  ThreadType,
} from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { ThreadModel } from '../../models/thread';
import { agentOperations, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

const TERMINAL_SOURCE_STATUSES = new Set(['completed', 'failed', 'stale']);

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

export class InvalidUnderstandingSessionError extends Error {
  constructor(cause: unknown) {
    super('Onboarding Understanding session manifest is invalid', { cause });
    this.name = 'InvalidUnderstandingSessionError';
  }
}

export class UnderstandingMergeSourcesChangedError extends Error {
  constructor() {
    super('Understanding completed sources changed during merge claim; retry validation');
    this.name = 'UnderstandingMergeSourcesChangedError';
  }
}

export class UnderstandingResourceNotFoundError extends Error {
  constructor(resource: 'result' | 'session' | 'topic') {
    super(`Onboarding Understanding ${resource} was not found`);
    this.name = 'UnderstandingResourceNotFoundError';
  }
}

export class UnderstandingPreconditionError extends Error {
  constructor(reason: 'result_not_confirmable' | 'source_not_retryable') {
    super(`Onboarding Understanding precondition failed: ${reason}`);
    this.name = 'UnderstandingPreconditionError';
  }
}

const completedSourceTuples = (session: OnboardingUnderstandingSession) =>
  session.runs
    .filter((run) => run.status === 'completed')
    .map((run) => ({
      assistantMessageId: run.assistantMessageId,
      operationId: run.operationId,
      sourceId: run.source.id,
      status: run.status,
      threadId: run.threadId,
    }));

const parseSession = (value: unknown): OnboardingUnderstandingSession => {
  try {
    return OnboardingUnderstandingSessionSchema.parse(value);
  } catch (error) {
    throw new InvalidUnderstandingSessionError(error);
  }
};

export interface UnderstandingResetCleanup {
  operationIds: string[];
  session: OnboardingUnderstandingSession;
}

export class UnderstandingSessionRepository {
  private readonly threadModel: ThreadModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.threadModel = new ThreadModel(db, userId, workspaceId);
  }

  get = async (topicId: string): Promise<OnboardingUnderstandingSession | undefined> => {
    const [topic] = await this.db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(
        and(
          eq(topics.id, topicId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
        ),
      );
    const session = topic?.metadata?.onboardingSession?.understanding;
    return session ? parseSession(session) : undefined;
  };

  install = async (
    topicId: string,
    session: OnboardingUnderstandingSession,
    expectedPriorSessionId?: string,
  ): Promise<OnboardingUnderstandingSession> => {
    const parsed = parseSession(session);
    const next = await this.mutateSession(topicId, (current) => {
      if (expectedPriorSessionId === undefined) {
        if (current) return current;
      } else {
        if (!current) throw new StaleUnderstandingSessionError(expectedPriorSessionId);
        if (
          current.id !== expectedPriorSessionId ||
          current.runs.length !== 0 ||
          current.status !== 'failed' ||
          current.mergeRun
        ) {
          return current;
        }
      }
      return { ...parsed, status: projectOnboardingUnderstandingSessionStatus(parsed) };
    });

    return next as OnboardingUnderstandingSession;
  };

  update = async (
    topicId: string,
    sessionId: string,
    mutate: (session: OnboardingUnderstandingSession) => OnboardingUnderstandingSession,
  ): Promise<OnboardingUnderstandingSession> => {
    const next = await this.mutateSession(topicId, (current) => {
      if (!current) throw new UnderstandingSessionNotFoundError(topicId);
      if (current.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);

      const updated = parseSession(mutate(parseSession(current)));
      return { ...updated, status: projectOnboardingUnderstandingSessionStatus(updated) };
    });

    return next as OnboardingUnderstandingSession;
  };

  claimMerge = async (topicId: string, sessionId: string, threadId: string): Promise<boolean> => {
    const session = await this.get(topicId);
    if (!session) throw new UnderstandingSessionNotFoundError(topicId);
    if (session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
    if (session.mergeRun) return false;

    const allTerminal = session.runs.every((run) => TERMINAL_SOURCE_STATUSES.has(run.status));
    const completedRuns = session.runs.filter((run) => run.status === 'completed');
    if (!allTerminal || completedRuns.length === 0) return false;

    for (const run of completedRuns) {
      const thread = await this.threadModel.findById(run.threadId);
      if (
        !thread ||
        thread.topicId !== topicId ||
        thread.type !== ThreadType.Isolation ||
        thread.metadata?.onboardingUnderstanding?.kind !== 'source'
      ) {
        throw new Error(`Invalid or unowned Understanding source thread: ${run.threadId}`);
      }
    }
    const validatedCompletedSources = completedSourceTuples(session);
    let claimed = false;
    await this.update(topicId, sessionId, (current) => {
      if (current.mergeRun) return current;

      if (
        JSON.stringify(completedSourceTuples(current)) !== JSON.stringify(validatedCompletedSources)
      ) {
        throw new UnderstandingMergeSourcesChangedError();
      }

      const allTerminal = current.runs.every((run) => TERMINAL_SOURCE_STATUSES.has(run.status));
      const hasCompletedSource = current.runs.some((run) => run.status === 'completed');
      if (!allTerminal || !hasCompletedSource) return current;

      const collides = current.runs.some((run) => run.threadId === threadId);
      if (collides) throw new Error('Understanding merge identifiers collide with a source run');

      claimed = true;
      return {
        ...current,
        mergeRun: {
          inputThreadIds: current.runs
            .filter((run) => run.status === 'completed')
            .map((run) => run.threadId),
          status: 'pending',
          threadId,
        },
      };
    });

    return claimed;
  };

  removeForReset = async (topicId: string): Promise<UnderstandingResetCleanup | undefined> =>
    this.db.transaction(async (tx) => {
      const topicOwnership = buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        topics,
      );
      const [topic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, topicId), topicOwnership))
        .for('update');
      const onboardingSession = topic?.metadata?.onboardingSession;
      const persisted = onboardingSession?.understanding;
      if (!topic || !onboardingSession || !persisted) return;

      const session = parseSession(persisted);
      const allRuns = [...(session.retiredRuns ?? []), ...session.runs];
      const allMergeRuns = [
        ...(session.retiredMergeRuns ?? []),
        ...(session.mergeRun ? [session.mergeRun] : []),
      ];
      const references = new Map([
        ...allRuns.map((run) => [run.threadId, 'source'] as const),
        ...allMergeRuns.map((run) => [run.threadId, 'merged'] as const),
      ]);
      const threadIds = [...references.keys()];
      const operationReferences = [
        ...allRuns.flatMap(({ operationId, threadId }) =>
          operationId ? [{ operationId, threadId }] : [],
        ),
        ...allMergeRuns.flatMap(({ operationId, threadId }) =>
          operationId ? [{ operationId, threadId }] : [],
        ),
      ];
      const expectedOperationThreads = new Map(
        operationReferences.map(({ operationId, threadId }) => [operationId, threadId]),
      );
      if (expectedOperationThreads.size !== operationReferences.length) {
        throw new Error('Understanding reset contains colliding operation references');
      }
      const operationIds = [...expectedOperationThreads.keys()];
      let validatedOperationIds: string[] = [];

      if (operationIds.length > 0) {
        const operationOwnership = buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          agentOperations,
        );
        const existingOperations = await tx
          .select({ id: agentOperations.id })
          .from(agentOperations)
          .where(inArray(agentOperations.id, operationIds));
        const ownedOperations = await tx
          .select({
            id: agentOperations.id,
            threadId: agentOperations.threadId,
            topicId: agentOperations.topicId,
          })
          .from(agentOperations)
          .where(and(inArray(agentOperations.id, operationIds), operationOwnership))
          .for('update');
        if (existingOperations.length !== ownedOperations.length) {
          throw new Error('Understanding reset references an unowned operation');
        }
        for (const operation of ownedOperations) {
          if (
            operation.topicId !== topicId ||
            operation.threadId !== expectedOperationThreads.get(operation.id)
          ) {
            throw new Error(`Invalid Understanding reset operation: ${operation.id}`);
          }
        }
        const validated = new Set(ownedOperations.map(({ id }) => id));
        validatedOperationIds = operationIds.filter((operationId) => validated.has(operationId));
      }

      if (threadIds.length > 0) {
        const threadOwnership = buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          threads,
        );
        const existingThreads = await tx
          .select({ id: threads.id })
          .from(threads)
          .where(inArray(threads.id, threadIds));
        const ownedThreads = await tx
          .select()
          .from(threads)
          .where(and(inArray(threads.id, threadIds), threadOwnership))
          .for('update');
        if (existingThreads.length !== ownedThreads.length) {
          throw new Error('Understanding reset references an unowned thread');
        }
        for (const thread of ownedThreads) {
          if (
            thread.topicId !== topicId ||
            thread.type !== ThreadType.Isolation ||
            thread.metadata?.onboardingUnderstanding?.kind !== references.get(thread.id)
          ) {
            throw new Error(`Invalid Understanding reset thread: ${thread.id}`);
          }
        }

        await tx.delete(threads).where(and(inArray(threads.id, threadIds), threadOwnership));
      }

      await tx
        .update(topics)
        .set({
          metadata: {
            ...topic.metadata,
            onboardingSession: {
              ...onboardingSession,
              understanding: undefined,
            },
          },
          updatedAt: new Date(),
        })
        .where(and(eq(topics.id, topicId), topicOwnership));

      return { operationIds: validatedOperationIds, session };
    });

  private mutateSession = async (
    topicId: string,
    mutate: (
      current: OnboardingUnderstandingSession | undefined,
    ) => OnboardingUnderstandingSession | undefined,
  ): Promise<OnboardingUnderstandingSession | undefined> =>
    this.db.transaction(async (tx) => {
      const ownership = buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        topics,
      );
      const [topic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, topicId), ownership))
        .for('update');
      if (!topic) throw new UnderstandingResourceNotFoundError('topic');
      if (!topic.metadata?.onboardingSession) {
        throw new UnderstandingSessionNotFoundError(topicId);
      }

      const persisted = topic.metadata.onboardingSession.understanding;
      const next = mutate(persisted ? parseSession(persisted) : undefined);
      const parsed = next ? parseSession(next) : undefined;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...topic.metadata,
            onboardingSession: { ...topic.metadata.onboardingSession, understanding: parsed },
          },
          updatedAt: new Date(),
        })
        .where(and(eq(topics.id, topicId), ownership));

      return parsed;
    });
}
