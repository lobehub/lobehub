import type {
  OnboardingUnderstandingSession,
  UnderstandingMergeRun,
  UnderstandingSourceRun,
} from '@lobechat/types';
import {
  OnboardingUnderstandingSessionSchema,
  projectOnboardingUnderstandingSessionStatus,
  ThreadType,
} from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

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

export class StaleUnderstandingWorkflowError extends Error {
  constructor(workflowRunId: string) {
    super(`Onboarding Understanding workflow is no longer active: ${workflowRunId}`);
    this.name = 'StaleUnderstandingWorkflowError';
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
  constructor(reason: 'result_not_confirmable' | 'source_not_retryable') {
    super(`Onboarding Understanding precondition failed: ${reason}`);
    this.name = 'UnderstandingPreconditionError';
  }
}

const parseSession = (value: unknown): OnboardingUnderstandingSession => {
  try {
    return OnboardingUnderstandingSessionSchema.parse(value);
  } catch (error) {
    throw new InvalidUnderstandingSessionError(error);
  }
};

type SourceRunUpdate = Partial<
  Pick<UnderstandingSourceRun, 'assistantMessageId' | 'diagnostics' | 'resultId' | 'status'>
>;

type MergeRunUpdate = Partial<
  Pick<UnderstandingMergeRun, 'assistantMessageId' | 'diagnostics' | 'resultId' | 'status'>
>;

export class UnderstandingSessionRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

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
  ): Promise<OnboardingUnderstandingSession> => {
    const parsed = parseSession(session);
    const next = await this.mutateSession(topicId, (current) => {
      if (current) return current;
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

  attachWorkflowRun = (
    topicId: string,
    sessionId: string,
    workflowRunId: string,
  ): Promise<OnboardingUnderstandingSession> =>
    this.update(topicId, sessionId, (session) => ({ ...session, workflowRunId }));

  updateSourceRun = (
    topicId: string,
    sessionId: string,
    workflowRunId: string,
    sourceId: string,
    patch: SourceRunUpdate,
  ): Promise<OnboardingUnderstandingSession> =>
    this.update(topicId, sessionId, (session) => {
      this.assertWorkflowRun(session, workflowRunId);
      const runIndex = session.runs.findIndex((run) => run.source.id === sourceId);
      if (runIndex < 0) throw new Error(`Understanding source was not found: ${sourceId}`);

      return {
        ...session,
        runs: session.runs.map((run, index) => (index === runIndex ? { ...run, ...patch } : run)),
      };
    });

  setMergeRun = (
    topicId: string,
    sessionId: string,
    workflowRunId: string,
    mergeRun: UnderstandingMergeRun,
  ): Promise<OnboardingUnderstandingSession> =>
    this.update(topicId, sessionId, (session) => {
      this.assertWorkflowRun(session, workflowRunId);
      if (!session.mergeRun) return { ...session, mergeRun };
      if (session.mergeRun.threadId === mergeRun.threadId) return session;

      throw new Error('Understanding session already has a different merge run');
    });

  updateMergeRun = (
    topicId: string,
    sessionId: string,
    workflowRunId: string,
    patch: MergeRunUpdate,
  ): Promise<OnboardingUnderstandingSession> =>
    this.update(topicId, sessionId, (session) => {
      this.assertWorkflowRun(session, workflowRunId);
      if (!session.mergeRun) throw new Error('Understanding merge run was not found');
      return { ...session, mergeRun: { ...session.mergeRun, ...patch } };
    });

  removeForReset = async (topicId: string): Promise<OnboardingUnderstandingSession | undefined> =>
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
      const references = new Map([
        ...session.runs.map((run) => [run.threadId, 'source'] as const),
        ...(session.mergeRun ? [[session.mergeRun.threadId, 'merged'] as const] : []),
      ]);
      const threadIds = [...references.keys()];

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
            onboardingSession: { ...onboardingSession, understanding: undefined },
          },
          updatedAt: new Date(),
        })
        .where(and(eq(topics.id, topicId), topicOwnership));

      return session;
    });

  private assertWorkflowRun = (
    session: OnboardingUnderstandingSession,
    workflowRunId: string,
  ): void => {
    if (session.workflowRunId !== workflowRunId) {
      throw new StaleUnderstandingWorkflowError(workflowRunId);
    }
  };

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
