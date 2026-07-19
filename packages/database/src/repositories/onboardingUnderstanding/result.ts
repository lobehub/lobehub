import type {
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingMergedResult,
  UnderstandingSourceRef,
  UnderstandingSourceResult,
} from '@lobechat/types';
import {
  CollectionDiagnosticsSummarySchema,
  OnboardingUnderstandingMessageMetadataSchema,
  OnboardingUnderstandingSessionSchema,
  projectOnboardingUnderstandingSessionStatus,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';
import { and, eq, sql } from 'drizzle-orm';
import { isEqual } from 'es-toolkit';

import { MessageModel } from '../../models/message';
import { ThreadModel } from '../../models/thread';
import { messages, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../../utils/workspace';
import {
  InvalidUnderstandingSessionError,
  StaleUnderstandingRunError,
  StaleUnderstandingSessionError,
  UnderstandingSessionRepository,
} from './session';

interface ResultIdentity {
  assistantMessageId: string;
  sessionId: string;
  threadId: string;
  topicId: string;
}

interface SourceResultIdentity extends ResultIdentity {
  sourceId: string;
}

type ResultReference =
  | (ResultIdentity & {
      kind: 'merge';
      inputThreadIds: string[];
    })
  | (SourceResultIdentity & {
      kind: 'source';
      source: UnderstandingSourceRef;
    });

const genericContent: Record<OnboardingUnderstandingMessageMetadata['kind'], string> = {
  merge_error: 'Understanding profile synthesis failed.',
  merged: 'Understanding profile synthesis completed.',
  source: 'Understanding source analysis completed.',
  source_error: 'Understanding source analysis failed.',
};

const parseSession = (value: unknown): OnboardingUnderstandingSession => {
  try {
    return OnboardingUnderstandingSessionSchema.parse(value);
  } catch (error) {
    throw new InvalidUnderstandingSessionError(error);
  }
};

const storedResult = (metadata: unknown): unknown => {
  if (metadata === null || metadata === undefined) return;
  if (!isPlainRecord(metadata)) {
    throw new Error('Invalid Understanding result message metadata');
  }
  return Object.hasOwn(metadata, 'onboardingUnderstanding')
    ? metadata.onboardingUnderstanding
    : undefined;
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
      metadata: { onboardingUnderstanding: { kind } },
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

  finalizeSource = async (
    input: SourceResultIdentity & { agentId: string; metadata: UnderstandingSourceResult },
  ): Promise<UnderstandingSourceResult> => {
    const parsed = OnboardingUnderstandingMessageMetadataSchema.parse(input.metadata);
    if (parsed.kind !== 'source' && parsed.kind !== 'source_error') {
      throw new Error('Expected an Understanding source result');
    }
    await this.finalize(input, parsed);
    return parsed;
  };

  finalizeMerge = async (
    input: ResultIdentity & { agentId: string; metadata: UnderstandingMergedResult },
  ): Promise<UnderstandingMergedResult> => {
    const parsed = OnboardingUnderstandingMessageMetadataSchema.parse(input.metadata);
    if (parsed.kind !== 'merged' && parsed.kind !== 'merge_error') {
      throw new Error('Expected an Understanding merged result');
    }
    await this.finalize(input, parsed);
    return parsed;
  };

  readSource = async (
    input: SourceResultIdentity,
  ): Promise<UnderstandingSourceResult | undefined> => {
    const result = await this.readReference(input.topicId, await this.getReference(input));
    if (!result) return;
    if (result.kind !== 'source' && result.kind !== 'source_error') {
      throw new Error('Expected an Understanding source result');
    }
    return result;
  };

  readMerge = async (input: ResultIdentity): Promise<UnderstandingMergedResult | undefined> => {
    const result = await this.readReference(input.topicId, await this.getReference(input));
    if (!result) return;
    if (result.kind !== 'merged' && result.kind !== 'merge_error') {
      throw new Error('Expected an Understanding merged result');
    }
    return result;
  };

  private assertMessage = (
    message: { role?: string | null; threadId?: string | null; topicId?: string | null },
    topicId: string,
    reference: ResultReference,
  ) => {
    if (
      message.role !== 'assistant' ||
      message.threadId !== reference.threadId ||
      message.topicId !== topicId
    ) {
      throw new Error('Understanding result message does not match its active run reference');
    }
  };

  private assertResult = (
    result: OnboardingUnderstandingMessageMetadata,
    reference: ResultReference,
  ) => {
    if (reference.kind === 'source') {
      if (
        result.kind === 'merged' ||
        result.kind === 'merge_error' ||
        !isEqual(result.source, reference.source)
      ) {
        throw new Error('Understanding source result does not match its active run reference');
      }
    } else if (
      !['merged', 'merge_error'].includes(result.kind) ||
      JSON.stringify(result.inputThreadIds) !== JSON.stringify(reference.inputThreadIds)
    ) {
      throw new Error('Understanding merged result does not match completed source runs');
    }
  };

  private async finalize(
    input: (ResultIdentity | SourceResultIdentity) & { agentId: string },
    result: OnboardingUnderstandingMessageMetadata,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const topicOwnership = buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        topics,
      );
      const [topic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, input.topicId), topicOwnership))
        .for('update');
      if (!topic) throw new Error(`Understanding topic not found: ${input.topicId}`);

      const session = parseSession(topic.metadata?.onboardingSession?.understanding);
      if (session.id !== input.sessionId) throw new StaleUnderstandingSessionError(input.sessionId);
      const terminalFailure = ['source_error', 'merge_error'].includes(result.kind);
      const reference = this.resolveReference(session, input, terminalFailure);
      this.assertResult(result, reference);

      const threadOwnership = buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        threads,
      );
      const [thread] = await tx
        .select()
        .from(threads)
        .where(and(eq(threads.id, reference.threadId), threadOwnership))
        .for('update');
      const marker = reference.kind === 'merge' ? 'merged' : 'source';
      if (
        !thread ||
        thread.topicId !== input.topicId ||
        thread.type !== ThreadType.Isolation ||
        thread.metadata?.onboardingUnderstanding?.kind !== marker
      ) {
        throw new Error(`Invalid Understanding result thread: ${reference.threadId}`);
      }

      const messageOwnership = buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        messages,
      );
      const [message] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, reference.assistantMessageId), messageOwnership))
        .for('update');
      if (message) this.assertMessage(message, input.topicId, reference);
      const existing = storedResult(message?.metadata);
      const terminalStatus = terminalFailure ? ThreadStatus.Failed : ThreadStatus.Completed;
      if (existing !== undefined) {
        const parsed = OnboardingUnderstandingMessageMetadataSchema.parse(existing);
        this.assertResult(parsed, reference);
        if (
          isEqual(parsed, result) &&
          message?.content === genericContent[result.kind] &&
          thread.status === terminalStatus &&
          this.hasResult(session, reference, result)
        ) {
          return;
        }
        throw new Error(`Understanding result already finalized: ${reference.assistantMessageId}`);
      }
      if ([ThreadStatus.Completed, ThreadStatus.Failed].includes(thread.status)) {
        throw new Error(`Understanding result thread is already terminal: ${reference.threadId}`);
      }

      if (message) {
        const serialized = JSON.stringify(result);
        const [updatedMessage] = await tx
          .update(messages)
          .set({
            content: genericContent[result.kind],
            metadata: sql`jsonb_set(coalesce(${messages.metadata}, '{}'::jsonb), '{onboardingUnderstanding}', ${serialized}::jsonb, true)`,
            updatedAt: new Date(),
          })
          .where(and(eq(messages.id, reference.assistantMessageId), messageOwnership))
          .returning({ id: messages.id });
        if (!updatedMessage) throw new Error('Failed to finalize Understanding result message');
      } else {
        const [occupied] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.id, reference.assistantMessageId));
        if (occupied) {
          throw new Error('Understanding result message identity is already occupied');
        }
        if (!terminalFailure) {
          throw new Error(
            `Understanding result message not found: ${reference.assistantMessageId}`,
          );
        }
        await tx.insert(messages).values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              agentId: input.agentId,
              content: genericContent[result.kind],
              id: reference.assistantMessageId,
              metadata: { onboardingUnderstanding: result },
              role: 'assistant',
              threadId: reference.threadId,
              topicId: input.topicId,
            },
          ),
        );
      }

      const [updatedThread] = await tx
        .update(threads)
        .set({ status: terminalStatus, updatedAt: new Date() })
        .where(and(eq(threads.id, reference.threadId), threadOwnership))
        .returning({ id: threads.id });
      if (!updatedThread) throw new Error('Failed to finalize Understanding result thread');

      const onboardingSession = topic.metadata?.onboardingSession;
      if (!onboardingSession)
        throw new InvalidUnderstandingSessionError('Missing onboarding session');
      await tx
        .update(topics)
        .set({
          metadata: {
            ...topic.metadata,
            onboardingSession: {
              ...onboardingSession,
              understanding: this.withResult(session, reference, result),
            },
          },
          updatedAt: new Date(),
        })
        .where(and(eq(topics.id, input.topicId), topicOwnership));
    });
  }

  private async getReference(
    input: ResultIdentity | SourceResultIdentity,
  ): Promise<ResultReference> {
    const session = await this.sessionRepository.get(input.topicId);
    if (!session || session.id !== input.sessionId) {
      throw new StaleUnderstandingSessionError(input.sessionId);
    }
    return this.resolveReference(session, input);
  }

  private async readReference(topicId: string, reference: ResultReference) {
    const thread = await this.threadModel.findById(reference.threadId);
    if (!thread) {
      const [occupied] = await this.db
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, reference.threadId));
      if (occupied) throw new Error(`Invalid Understanding result thread: ${reference.threadId}`);
      return;
    }
    const marker = reference.kind === 'merge' ? 'merged' : 'source';
    if (
      thread.topicId !== topicId ||
      thread.type !== ThreadType.Isolation ||
      thread.metadata?.onboardingUnderstanding?.kind !== marker
    ) {
      throw new Error(`Invalid Understanding result thread: ${reference.threadId}`);
    }
    const message = await this.messageModel.findById(reference.assistantMessageId);
    if (!message) {
      const [occupied] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, reference.assistantMessageId));
      if (occupied) {
        throw new Error(
          `Understanding result message does not match its active run reference: ${reference.assistantMessageId}`,
        );
      }
      return;
    }
    this.assertMessage(message, topicId, reference);
    const metadata = storedResult(message.metadata);
    if (metadata === undefined) return;
    const parsed = OnboardingUnderstandingMessageMetadataSchema.parse(metadata);
    this.assertResult(parsed, reference);
    return parsed;
  }

  private resolveReference(
    session: OnboardingUnderstandingSession,
    input: ResultIdentity | SourceResultIdentity,
    allowMessageClaim = false,
  ): ResultReference {
    if ('sourceId' in input) {
      const run = session.runs.find(({ source }) => source.id === input.sourceId);
      if (
        !run ||
        run.threadId !== input.threadId ||
        (run.assistantMessageId
          ? run.assistantMessageId !== input.assistantMessageId
          : !allowMessageClaim)
      ) {
        throw new StaleUnderstandingRunError('source', input.threadId);
      }
      return {
        assistantMessageId: input.assistantMessageId,
        kind: 'source',
        sessionId: input.sessionId,
        source: run.source,
        sourceId: input.sourceId,
        threadId: input.threadId,
        topicId: input.topicId,
      };
    }
    const run = session.mergeRun;
    if (
      !run ||
      run.threadId !== input.threadId ||
      (run.assistantMessageId
        ? run.assistantMessageId !== input.assistantMessageId
        : !allowMessageClaim)
    ) {
      throw new StaleUnderstandingRunError('merge', input.threadId);
    }
    return {
      assistantMessageId: input.assistantMessageId,
      inputThreadIds: session.runs
        .filter(({ status }) => status === 'completed')
        .map(({ threadId }) => threadId),
      kind: 'merge',
      sessionId: input.sessionId,
      threadId: input.threadId,
      topicId: input.topicId,
    };
  }

  private hasResult(
    session: OnboardingUnderstandingSession,
    reference: ResultReference,
    result: OnboardingUnderstandingMessageMetadata,
  ) {
    const run =
      reference.kind === 'source'
        ? session.runs.find(({ source }) => source.id === reference.sourceId)
        : session.mergeRun;
    return run?.resultId === result.resultId;
  }

  private withResult(
    session: OnboardingUnderstandingSession,
    reference: ResultReference,
    result: OnboardingUnderstandingMessageMetadata,
  ): OnboardingUnderstandingSession {
    const patch = {
      assistantMessageId: reference.assistantMessageId,
      diagnostics: CollectionDiagnosticsSummarySchema.parse(result.diagnostics),
      resultId: result.resultId,
      status: ['source_error', 'merge_error'].includes(result.kind)
        ? ('failed' as const)
        : ('completed' as const),
    };
    const updated =
      reference.kind === 'source'
        ? {
            ...session,
            runs: session.runs.map((run) =>
              run.source.id === reference.sourceId ? { ...run, ...patch } : run,
            ),
          }
        : { ...session, mergeRun: session.mergeRun && { ...session.mergeRun, ...patch } };
    return OnboardingUnderstandingSessionSchema.parse({
      ...updated,
      status: projectOnboardingUnderstandingSessionStatus(updated),
    });
  }
}
