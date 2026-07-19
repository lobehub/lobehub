import {
  CollectionDiagnosticsSummarySchema,
  type OnboardingUnderstandingConfirmationMetadata,
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';
import { and, desc, eq, isNull } from 'drizzle-orm';

import {
  lockUserPersonaOwner,
  upsertUserPersonaInTransaction,
} from '../../models/userMemory/persona';
import { messages, threads, topics, userPersonaDocuments } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  StaleUnderstandingSessionError,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from './session';

interface ConfirmUnderstandingInput {
  resultId: string;
  sessionId: string;
  topicId: string;
}

export class UnderstandingConfirmationRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  confirm = async ({ resultId, sessionId, topicId }: ConfirmUnderstandingInput) =>
    this.db.transaction(async (tx) => {
      await lockUserPersonaOwner(tx, this.userId);

      const [topic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(
          and(eq(topics.id, topicId), eq(topics.userId, this.userId), isNull(topics.workspaceId)),
        )
        .for('update');
      if (!topic) throw new UnderstandingResourceNotFoundError('topic');
      const onboarding = topic.metadata?.onboardingSession;
      if (!onboarding || onboarding.finishedAt) {
        throw new UnderstandingResourceNotFoundError('topic');
      }

      const parsed = OnboardingUnderstandingSessionSchema.safeParse(onboarding.understanding);
      if (!parsed.success) throw new UnderstandingSessionNotFoundError(topicId);
      const session = parsed.data;
      if (session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
      const merge = session.mergeRun;
      if (
        !merge ||
        !merge.assistantMessageId ||
        merge.status !== 'completed' ||
        !['completed', 'partial'].includes(session.status)
      ) {
        throw new UnderstandingPreconditionError('result_not_confirmable');
      }
      if (merge.resultId !== resultId) throw new UnderstandingResourceNotFoundError('result');

      const [thread] = await tx
        .select({
          metadata: threads.metadata,
          status: threads.status,
          topicId: threads.topicId,
          type: threads.type,
        })
        .from(threads)
        .where(
          and(
            eq(threads.id, merge.threadId),
            eq(threads.userId, this.userId),
            isNull(threads.workspaceId),
          ),
        )
        .for('update');
      if (
        !thread ||
        thread.topicId !== topicId ||
        thread.type !== ThreadType.Isolation ||
        thread.status !== ThreadStatus.Completed ||
        thread.metadata?.onboardingUnderstanding?.kind !== 'merged'
      ) {
        throw new UnderstandingResourceNotFoundError('result');
      }

      const [message] = await tx
        .select({
          metadata: messages.metadata,
          role: messages.role,
          threadId: messages.threadId,
          topicId: messages.topicId,
        })
        .from(messages)
        .where(
          and(
            eq(messages.id, merge.assistantMessageId),
            eq(messages.userId, this.userId),
            isNull(messages.workspaceId),
          ),
        )
        .for('update');
      if (
        !message ||
        message.role !== 'assistant' ||
        message.topicId !== topicId ||
        message.threadId !== merge.threadId
      ) {
        throw new UnderstandingResourceNotFoundError('result');
      }
      const result = OnboardingUnderstandingMessageMetadataSchema.safeParse(
        isPlainRecord(message.metadata) ? message.metadata.onboardingUnderstanding : undefined,
      );
      if (!result.success || result.data.kind !== 'merged' || result.data.resultId !== resultId) {
        throw new UnderstandingPreconditionError('result_not_confirmable');
      }
      const contributingRuns = session.runs.filter((run) => run.status === 'completed');
      const inputThreadIds = contributingRuns.map(({ threadId }) => threadId);
      if (JSON.stringify(result.data.inputThreadIds) !== JSON.stringify(inputThreadIds)) {
        throw new UnderstandingPreconditionError('result_not_confirmable');
      }

      const [currentPersona] = await tx
        .select()
        .from(userPersonaDocuments)
        .where(
          and(
            eq(userPersonaDocuments.userId, this.userId),
            eq(userPersonaDocuments.profile, 'default'),
          ),
        )
        .orderBy(desc(userPersonaDocuments.version), desc(userPersonaDocuments.updatedAt))
        .for('update');
      const currentMetadata = isPlainRecord(currentPersona?.metadata)
        ? currentPersona.metadata
        : {};
      const previousConfirmation = currentMetadata.onboardingUnderstanding;
      if (
        currentPersona &&
        isPlainRecord(previousConfirmation) &&
        previousConfirmation.sessionId === session.id &&
        previousConfirmation.mergeThreadId === merge.threadId
      ) {
        return { document: currentPersona };
      }

      const { analysis, diagnostics } = result.data;
      const confirmationMetadata = {
        composition: analysis.composition,
        diagnostics: CollectionDiagnosticsSummarySchema.parse(diagnostics),
        mergeThreadId: merge.threadId,
        profile: analysis.profile,
        sessionId: session.id,
        sources: contributingRuns.map(({ source }) => source),
        topicId,
      } satisfies OnboardingUnderstandingConfirmationMetadata;
      return upsertUserPersonaInTransaction(tx, this.userId, {
        metadata: {
          ...currentMetadata,
          onboardingUnderstanding: confirmationMetadata,
        },
        persona: analysis.personaProposal.content,
        reasoning: analysis.personaProposal.reasoning,
        tagline: analysis.personaProposal.tagline,
      });
    });
}
