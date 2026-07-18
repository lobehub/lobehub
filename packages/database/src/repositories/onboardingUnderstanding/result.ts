import type {
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingSourceRef,
} from '@lobechat/types';
import {
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';
import { isEqual } from 'es-toolkit';

import { MessageModel } from '../../models/message';
import { ThreadModel } from '../../models/thread';
import { messages, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../../utils/workspace';
import {
  InvalidUnderstandingSessionError,
  StaleUnderstandingSessionError,
  UnderstandingSessionRepository,
} from './session';

type ResultKind = OnboardingUnderstandingMessageMetadata['kind'];

type ResultReference =
  | {
      assistantMessageId: string;
      kind: 'source';
      source: UnderstandingSourceRef;
      threadId: string;
    }
  | {
      assistantMessageId: string;
      inputThreadIds: string[];
      kind: 'merge';
      threadId: string;
    };

const genericContent: Record<ResultKind, string> = {
  merge_error: 'Understanding profile synthesis failed.',
  merged: 'Understanding profile synthesis completed.',
  source: 'Understanding source analysis completed.',
  source_error: 'Understanding source analysis failed.',
};

const getStoredResultMetadata = (metadata: unknown): unknown => {
  if (metadata === null || metadata === undefined) return;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Invalid Understanding result message metadata');
  }
  const record = metadata as Record<string, unknown>;
  if (!Object.hasOwn(record, 'onboardingUnderstanding')) return;
  return record.onboardingUnderstanding;
};

export class UnderstandingResultRepository {
  private readonly messageModel: MessageModel;
  private readonly sessionRepository: UnderstandingSessionRepository;
  private readonly threadModel: ThreadModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.messageModel = new MessageModel(db, userId, workspaceId);
    this.sessionRepository = new UnderstandingSessionRepository(db, userId, workspaceId);
    this.threadModel = new ThreadModel(db, userId, workspaceId);
  }

  private resolveReference = (
    session: OnboardingUnderstandingSession,
    operationId: string,
  ): ResultReference => {
    const sourceRun = session.runs.find((run) => run.operationId === operationId);
    if (sourceRun) {
      if (!sourceRun.assistantMessageId) {
        throw new Error(`Understanding operation has no assistant message: ${operationId}`);
      }
      return {
        assistantMessageId: sourceRun.assistantMessageId,
        kind: 'source',
        source: sourceRun.source,
        threadId: sourceRun.threadId,
      };
    }

    if (session.mergeRun?.operationId === operationId) {
      if (!session.mergeRun.assistantMessageId) {
        throw new Error(`Understanding merge has no assistant message: ${operationId}`);
      }
      return {
        assistantMessageId: session.mergeRun.assistantMessageId,
        inputThreadIds: session.mergeRun.inputThreadIds,
        kind: 'merge',
        threadId: session.mergeRun.threadId,
      };
    }

    throw new Error(
      `Operation is not referenced by the active Understanding session: ${operationId}`,
    );
  };

  private getReference = async (
    topicId: string,
    sessionId: string,
    operationId: string,
  ): Promise<ResultReference> => {
    const session = await this.sessionRepository.get(topicId);
    if (!session || session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
    return this.resolveReference(session, operationId);
  };

  ensureThread = async ({
    agentId,
    kind,
    threadId,
    topicId,
  }: {
    agentId: string;
    kind: 'merged' | 'source';
    threadId: string;
    topicId: string;
  }) => {
    const created = await this.threadModel.create({
      agentId,
      id: threadId,
      metadata: {
        onboardingUnderstanding: { kind },
      },
      status: ThreadStatus.Pending,
      topicId,
      type: ThreadType.Isolation,
    });
    const thread = created ?? (await this.threadModel.findById(threadId));

    if (
      !thread ||
      thread.topicId !== topicId ||
      thread.type !== ThreadType.Isolation ||
      thread.metadata?.onboardingUnderstanding?.kind !== kind
    ) {
      throw new Error(`Invalid Understanding result thread: ${threadId}`);
    }

    return thread;
  };

  persist = async ({
    agentId,
    metadata,
    operationId,
    sessionId,
    topicId,
  }: {
    agentId: string;
    metadata: OnboardingUnderstandingMessageMetadata;
    operationId: string;
    sessionId: string;
    topicId: string;
  }): Promise<OnboardingUnderstandingMessageMetadata> => {
    const parsed = OnboardingUnderstandingMessageMetadataSchema.parse(metadata);
    const reference = await this.getReference(topicId, sessionId, operationId);
    this.assertResultMatchesReference(parsed, reference);
    await this.ensureThread({
      agentId,
      kind: reference.kind === 'merge' ? 'merged' : 'source',
      threadId: reference.threadId,
      topicId,
    });

    return this.db.transaction(async (tx) => {
      const [topic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(
          and(
            eq(topics.id, topicId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
          ),
        )
        .for('update');
      if (!topic) throw new Error(`Understanding topic not found: ${topicId}`);

      let activeSession: OnboardingUnderstandingSession;
      try {
        activeSession = OnboardingUnderstandingSessionSchema.parse(
          topic.metadata?.onboardingSession?.understanding,
        );
      } catch (error) {
        throw new InvalidUnderstandingSessionError(error);
      }
      if (activeSession.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
      const lockedReference = this.resolveReference(activeSession, operationId);
      if (!isEqual(lockedReference, reference)) {
        throw new Error('Understanding result reference changed while persisting');
      }

      const [thread] = await tx
        .select()
        .from(threads)
        .where(
          and(
            eq(threads.id, reference.threadId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        )
        .for('update');
      const expectedMarkerKind = reference.kind === 'merge' ? 'merged' : 'source';
      if (
        !thread ||
        thread.topicId !== topicId ||
        thread.type !== ThreadType.Isolation ||
        thread.metadata?.onboardingUnderstanding?.kind !== expectedMarkerKind
      ) {
        throw new Error(`Invalid Understanding result thread: ${reference.threadId}`);
      }

      const [existing] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.id, reference.assistantMessageId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
          ),
        )
        .for('update');
      const terminalStatus = ['source_error', 'merge_error'].includes(parsed.kind)
        ? ThreadStatus.Failed
        : ThreadStatus.Completed;

      const existingResultMetadata = getStoredResultMetadata(existing?.metadata);
      if (existingResultMetadata !== undefined) {
        this.assertMessageReference(existing, topicId, reference);
        const terminal = OnboardingUnderstandingMessageMetadataSchema.parse(existingResultMetadata);
        this.assertResultMatchesReference(terminal, reference);
        if (
          terminal.resultId === parsed.resultId &&
          isEqual(terminal, parsed) &&
          existing.content === genericContent[parsed.kind] &&
          thread.status === terminalStatus
        ) {
          return parsed;
        }
        throw new Error(`Understanding result already finalized: ${reference.assistantMessageId}`);
      }

      if ([ThreadStatus.Completed, ThreadStatus.Failed].includes(thread.status)) {
        throw new Error(`Understanding result thread is already terminal: ${reference.threadId}`);
      }

      if (existing) {
        this.assertMessageReference(existing, topicId, reference);
        const serialized = JSON.stringify(parsed);
        const [updatedMessage] = await tx
          .update(messages)
          .set({
            content: genericContent[parsed.kind],
            metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{onboardingUnderstanding}', ${serialized}::jsonb, true)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(messages.id, reference.assistantMessageId),
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
            ),
          )
          .returning({ id: messages.id });
        if (!updatedMessage) throw new Error('Failed to finalize Understanding result message');
      } else {
        await tx.insert(messages).values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              agentId,
              content: genericContent[parsed.kind],
              id: reference.assistantMessageId,
              metadata: sql`${JSON.stringify({ onboardingUnderstanding: parsed })}::jsonb`,
              role: 'assistant',
              threadId: reference.threadId,
              topicId,
            },
          ),
        );
      }

      const [updatedThread] = await tx
        .update(threads)
        .set({ status: terminalStatus, updatedAt: new Date() })
        .where(
          and(
            eq(threads.id, reference.threadId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        )
        .returning({ id: threads.id });
      if (!updatedThread) throw new Error('Failed to finalize Understanding result thread');

      return parsed;
    });
  };

  read = async ({
    operationId,
    sessionId,
    topicId,
  }: {
    operationId: string;
    sessionId: string;
    topicId: string;
  }): Promise<OnboardingUnderstandingMessageMetadata | undefined> => {
    const reference = await this.getReference(topicId, sessionId, operationId);
    const thread = await this.threadModel.findById(reference.threadId);
    if (!thread) {
      const [existingThread] = await this.db
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, reference.threadId));
      if (existingThread) {
        throw new Error(`Invalid Understanding result thread: ${reference.threadId}`);
      }
      return;
    }
    const expectedMarkerKind = reference.kind === 'merge' ? 'merged' : 'source';
    if (
      thread.topicId !== topicId ||
      thread.type !== ThreadType.Isolation ||
      thread.metadata?.onboardingUnderstanding?.kind !== expectedMarkerKind
    ) {
      throw new Error(`Invalid Understanding result thread: ${reference.threadId}`);
    }
    const message = await this.messageModel.findById(reference.assistantMessageId);
    if (!message) {
      const [existingMessage] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, reference.assistantMessageId));
      if (existingMessage) {
        throw new Error(
          `Understanding result message does not match its manifest reference: ${reference.assistantMessageId}`,
        );
      }
      return;
    }

    this.assertMessageReference(message, topicId, reference);
    const storedMetadata = getStoredResultMetadata(message.metadata);
    if (storedMetadata === undefined) return;
    const parsed = OnboardingUnderstandingMessageMetadataSchema.parse(storedMetadata);
    this.assertResultMatchesReference(parsed, reference);
    return parsed;
  };

  private assertMessageReference = (
    message: { role?: string | null; threadId?: string | null; topicId?: string | null },
    topicId: string,
    reference: ResultReference,
  ) => {
    if (
      message.role !== 'assistant' ||
      message.threadId !== reference.threadId ||
      message.topicId !== topicId
    ) {
      throw new Error('Understanding result message does not match its manifest reference');
    }
  };

  private assertResultMatchesReference = (
    result: OnboardingUnderstandingMessageMetadata,
    reference: ResultReference,
  ) => {
    if (reference.kind === 'source') {
      if (
        result.kind === 'merged' ||
        result.kind === 'merge_error' ||
        result.source.id !== reference.source.id ||
        result.source.provider !== reference.source.provider ||
        result.source.externalAccountId !== reference.source.externalAccountId ||
        result.source.displayName !== reference.source.displayName
      ) {
        throw new Error('Understanding source result does not match its manifest reference');
      }
      return;
    }

    if (
      !['merged', 'merge_error'].includes(result.kind) ||
      JSON.stringify(result.inputThreadIds) !== JSON.stringify(reference.inputThreadIds)
    ) {
      throw new Error('Understanding merged result does not match its manifest reference');
    }
  };
}
