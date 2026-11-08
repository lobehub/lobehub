import type {
  CreateMessageParams,
  DBMessageItem,
  ModelUsage,
  NewMessageQueryParams,
  UpdateMessageParams,
} from '@lobechat/types';
import { runTimedSinkStage as runTimedStage } from '@lobechat/utils';
import { and, eq, inArray } from 'drizzle-orm';

import { clampToolIdentifier } from '@/utils/clampToolIdentifier';
import { merge } from '@/utils/merge';
import { sanitizeNullBytes } from '@/utils/sanitizeNullBytes';

import {
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
} from '../../schemas';
import type { Transaction } from '../../type';
import { buildWorkspacePayload } from '../../utils/workspace';
import { recomputeTopicUsage } from '../topicUsage';
import { MessageScope } from './scope';
import type { ModelTimingContext } from './types';

interface CreateUserAndAssistantMessagesParams {
  assistantMessage: CreateMessageParams;
  userMessage: CreateMessageParams;
}

interface CreateUserAndAssistantMessagesOptions {
  /**
   * Ids minted by the caller (the client) for the pair. Either side may be
   * omitted, in which case this model mints that one — an older client that
   * sends no ids keeps working unchanged.
   *
   * Honouring a caller-supplied id is what lets the UI render the pair under
   * its final ids immediately, instead of showing placeholders and re-keying
   * them once this insert returns.
   */
  ids?: {
    assistantMessageId?: string;
    userMessageId?: string;
  };
  timing?: ModelTimingContext;
}

interface CreateMessageInsertParams {
  createdAt?: CreateMessageParams['createdAt'];
  fromModel?: CreateMessageParams['model'];
  fromProvider?: CreateMessageParams['provider'];
  message: Omit<
    CreateMessageParams,
    | 'createdAt'
    | 'fileChunks'
    | 'files'
    | 'model'
    | 'plugin'
    | 'pluginIntervention'
    | 'pluginState'
    | 'provider'
    | 'ragQueryId'
    | 'updatedAt'
  >;
  updatedAt?: CreateMessageParams['updatedAt'];
}

interface CreateMessageRelationParams {
  fileChunks?: CreateMessageParams['fileChunks'];
  files?: CreateMessageParams['files'];
  plugin?: CreateMessageParams['plugin'];
  pluginError?: CreateMessageParams['pluginError'];
  pluginIntervention?: CreateMessageParams['pluginIntervention'];
  pluginState?: CreateMessageParams['pluginState'];
  ragQueryId?: CreateMessageParams['ragQueryId'];
}

interface SplitCreateMessageParams {
  insert: CreateMessageInsertParams;
  relations: CreateMessageRelationParams;
}

export class MessageWriteMutations extends MessageScope {
  /**
   * Row-lock message roots in id order (`SELECT … FOR UPDATE`) and return
   * their content. Only meaningful on a transaction-bound instance; used by the
   * human-approval unit of work in `MessageApprovalRepo`.
   */
  lockContentForUpdate = async (ids: string[]) =>
    this.db
      .select({ content: messages.content, id: messages.id })
      .from(messages)
      .where(and(inArray(messages.id, ids), this.ownership()))
      .orderBy(messages.id)
      .for('update');

  /** Replace one message's content. Returns `false` when it is outside this scope. */
  updateContent = async (id: string, content: string): Promise<boolean> => {
    const [updated] = await this.db
      .update(messages)
      .set({ content })
      .where(and(eq(messages.id, id), this.ownership()))
      .returning({ id: messages.id });
    return Boolean(updated);
  };

  private splitCreateMessageParams = ({
    fileChunks,
    files,
    model: fromModel,
    plugin,
    pluginError,
    pluginIntervention,
    pluginState,
    provider: fromProvider,
    ragQueryId,
    updatedAt,
    createdAt,
    ...message
  }: CreateMessageParams): SplitCreateMessageParams => ({
    insert: {
      createdAt,
      fromModel,
      fromProvider,
      message,
      updatedAt,
    },
    relations: {
      fileChunks,
      files,
      plugin,
      pluginError,
      pluginIntervention,
      pluginState,
      ragQueryId,
    },
  });

  private buildMessageInsertValue = (
    { createdAt, fromModel, fromProvider, message, updatedAt }: CreateMessageInsertParams,
    id: string,
  ) => {
    // Ensure group message does not populate sessionId
    const normalizedMessage = message.groupId ? { ...message, sessionId: null } : message;
    const { usage: legacyUsage, ...metadata } =
      (normalizedMessage.metadata as Record<string, any> | undefined) || {};

    return buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        ...normalizedMessage,
        // Sanitize content to strip null bytes that PostgreSQL rejects
        content: sanitizeNullBytes(normalizedMessage.content),
        // TODO: remove this when the client is updated
        createdAt: createdAt ? new Date(createdAt) : undefined,
        id,
        metadata: normalizedMessage.metadata ? metadata : undefined,
        model: fromModel,
        provider: fromProvider,
        updatedAt: updatedAt ? new Date(updatedAt) : undefined,
        // Promote token usage into the dedicated `usage` column, preferring a
        // top-level `usage` over the legacy `metadata.usage`.
        usage: normalizedMessage.usage ?? (legacyUsage as ModelUsage | undefined),
      },
    );
  };

  private insertMessageRelationsInTransaction = async (
    trx: Transaction,
    {
      fileChunks,
      files,
      plugin,
      pluginError,
      pluginIntervention,
      pluginState,
      ragQueryId,
    }: CreateMessageRelationParams,
    message: CreateMessageInsertParams['message'],
    id: string,
    timing?: ModelTimingContext,
    timingPrefix: string = 'db.message.create',
  ): Promise<void> => {
    // Insert the plugin data if the message is a tool
    if (message.role === 'tool') {
      await runTimedStage(timing, `${timingPrefix}.plugin.insert`, () =>
        trx.insert(messagePlugins).values({
          apiName: clampToolIdentifier(plugin?.apiName),
          arguments: sanitizeNullBytes(plugin?.arguments),
          // A tool that fails on its first write only has pluginError to explain
          // itself; without it the model reads an empty tool result.
          error: sanitizeNullBytes(pluginError),
          id,
          identifier: clampToolIdentifier(plugin?.identifier),
          intervention: pluginIntervention,
          state: sanitizeNullBytes(pluginState),
          toolCallId: message.tool_call_id,
          type: plugin?.type,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        }),
      );
    }

    if (files && files.length > 0) {
      await runTimedStage(
        timing,
        `${timingPrefix}.files.insert`,
        () =>
          trx.insert(messagesFiles).values(
            files.map((file) => ({
              fileId: file,
              messageId: id,
              userId: this.userId,
              workspaceId: this.workspaceId ?? null,
            })),
          ),
        { fileCount: files.length },
      );
    }

    if (fileChunks && fileChunks.length > 0 && ragQueryId) {
      await runTimedStage(
        timing,
        `${timingPrefix}.fileChunks.insert`,
        () =>
          trx.insert(messageQueryChunks).values(
            fileChunks.map((chunk) => ({
              chunkId: chunk.id,
              messageId: id,
              queryId: ragQueryId,
              similarity: chunk.similarity?.toString(),
              userId: this.userId,
              workspaceId: this.workspaceId ?? null,
            })),
          ),
        { chunkCount: fileChunks.length },
      );
    }
  };

  private createInTransaction = async (
    trx: Transaction,
    params: CreateMessageParams,
    id: string,
    timing?: ModelTimingContext,
    timingPrefix: string = 'db.message.create',
  ): Promise<DBMessageItem> => {
    const { insert, relations } = this.splitCreateMessageParams(params);

    const [item] = (await runTimedStage(
      timing,
      `${timingPrefix}.messages.insert`,
      () => trx.insert(messages).values(this.buildMessageInsertValue(insert, id)).returning(),
      {
        hasGroupId: !!insert.message.groupId,
        hasTopicId: !!insert.message.topicId,
        role: insert.message.role,
      },
    )) as DBMessageItem[];

    await this.insertMessageRelationsInTransaction(
      trx,
      relations,
      insert.message,
      id,
      timing,
      timingPrefix,
    );

    return item;
  };

  create = async (
    params: CreateMessageParams,
    id: string = this.genId(),
    timing?: ModelTimingContext,
  ): Promise<DBMessageItem> => {
    return runTimedStage(
      timing,
      'db.message.create.transaction',
      () =>
        this.db.transaction(async (trx) => {
          const item = await this.createInTransaction(trx, params, id, timing);

          return item;
        }),
      {
        fileChunkCount: params.fileChunks?.length ?? 0,
        fileCount: params.files?.length ?? 0,
        hasTopicId: !!params.topicId,
        role: params.role,
      },
    );
  };

  createUserAndAssistantMessages = async (
    { userMessage, assistantMessage }: CreateUserAndAssistantMessagesParams,
    { ids, timing }: CreateUserAndAssistantMessagesOptions = {},
  ): Promise<{ assistantMessage: DBMessageItem; userMessage: DBMessageItem }> => {
    const userMessageId = ids?.userMessageId ?? this.genId();
    const assistantMessageId = ids?.assistantMessageId ?? this.genId();
    const createdAt = Date.now();
    const defaultUserCreatedAt = createdAt;
    const defaultAssistantCreatedAt = createdAt + 1;
    const userMessageWithTimestamp = {
      ...userMessage,
      createdAt: userMessage.createdAt ?? defaultUserCreatedAt,
      updatedAt:
        userMessage.updatedAt ?? (userMessage.createdAt ? undefined : defaultUserCreatedAt),
    };
    const assistantMessageWithParent = {
      ...assistantMessage,
      createdAt: assistantMessage.createdAt ?? defaultAssistantCreatedAt,
      parentId: userMessageId,
      updatedAt:
        assistantMessage.updatedAt ??
        (assistantMessage.createdAt ? undefined : defaultAssistantCreatedAt),
    };
    const topicIds = [
      ...new Set([userMessage.topicId, assistantMessage.topicId].filter(Boolean) as string[]),
    ];

    return runTimedStage(
      timing,
      'db.message.createUserAndAssistant.transaction',
      () =>
        this.db.transaction(async (trx) => {
          const userPayload = this.splitCreateMessageParams(userMessageWithTimestamp);
          const assistantPayload = this.splitCreateMessageParams(assistantMessageWithParent);
          const insertedMessages = (await runTimedStage(
            timing,
            'db.message.createUserAndAssistant.messages.insert',
            () =>
              trx
                .insert(messages)
                .values([
                  this.buildMessageInsertValue(userPayload.insert, userMessageId),
                  this.buildMessageInsertValue(assistantPayload.insert, assistantMessageId),
                ])
                .returning(),
            { hasTopicId: topicIds.length > 0, messageCount: 2 },
          )) as DBMessageItem[];
          const messageMap = new Map(insertedMessages.map((message) => [message.id, message]));

          await this.insertMessageRelationsInTransaction(
            trx,
            userPayload.relations,
            userPayload.insert.message,
            userMessageId,
            timing,
            'db.message.createUserAndAssistant.user',
          );
          await this.insertMessageRelationsInTransaction(
            trx,
            assistantPayload.relations,
            assistantPayload.insert.message,
            assistantMessageId,
            timing,
            'db.message.createUserAndAssistant.assistant',
          );

          const userMessageItem = messageMap.get(userMessageId);
          const assistantMessageItem = messageMap.get(assistantMessageId);

          if (!userMessageItem || !assistantMessageItem) {
            throw new Error('Failed to create user and assistant messages');
          }

          return { assistantMessage: assistantMessageItem, userMessage: userMessageItem };
        }),
      {
        assistantFileCount: assistantMessage.files?.length ?? 0,
        hasTopicId: topicIds.length > 0,
        userFileCount: userMessage.files?.length ?? 0,
      },
    );
  };

  batchCreate = async (newMessages: DBMessageItem[]) => {
    const messagesToInsert = newMessages.map((m) =>
      buildWorkspacePayload(
        { userId: this.userId, workspaceId: this.workspaceId },
        // TODO: need a better way to handle this
        { ...m, role: m.role as any },
      ),
    );

    return this.db.transaction(async (trx) => {
      const result = await trx.insert(messages).values(messagesToInsert);

      return result;
    });
  };

  createMessageQuery = async (params: NewMessageQueryParams) => {
    const result = await this.db
      .insert(messageQueries)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();

    return result[0];
  };

  update = async (
    id: string,
    { imageList, metadata, usage, ...message }: Partial<UpdateMessageParams>,
    timing?: ModelTimingContext,
  ): Promise<{ success: boolean }> => {
    // Accept legacy callers that still send `metadata.usage`, but persist usage
    // exclusively in the dedicated top-level column.
    const { usage: legacyUsage, ...metadataPatch } = (metadata as Record<string, any>) || {};
    const usageToWrite = usage ?? (legacyUsage as ModelUsage | undefined);
    const shouldUpdateMetadata = !!metadata || !!usageToWrite;
    // A patch that matches no row is a lost write, not a no-op: the caller asked
    // to persist content onto `id` and it went nowhere. Batched writers key their
    // retry ledger off this flag, so reporting success here silently drops data.
    let matchedRow = false;
    try {
      await runTimedStage(
        timing,
        'db.message.update.transaction',
        () =>
          this.db.transaction(async (trx) => {
            // 1. insert message files
            if (imageList && imageList.length > 0) {
              await runTimedStage(
                timing,
                'db.message.update.imageFiles.insert',
                () =>
                  trx.insert(messagesFiles).values(
                    imageList.map((file) => ({
                      fileId: file.id,
                      messageId: id,
                      userId: this.userId,
                      workspaceId: this.workspaceId ?? null,
                    })),
                  ),
                { imageCount: imageList.length },
              );
            }

            // 2. Merge non-usage metadata. A usage-bearing update also removes
            // any legacy `metadata.usage` left on the existing row.
            let mergedMetadata: Record<string, any> | undefined;
            if (shouldUpdateMetadata) {
              const [existingMessage] = await runTimedStage(
                timing,
                'db.message.update.metadata.select',
                () =>
                  trx
                    .select({ metadata: messages.metadata })
                    .from(messages)
                    .where(and(eq(messages.id, id), this.ownership())),
              );
              mergedMetadata = merge(existingMessage?.metadata || {}, metadataPatch);
              if (usageToWrite && mergedMetadata) delete mergedMetadata.usage;
            }
            const metadataToWrite = mergedMetadata;

            const [updated] = await runTimedStage(
              timing,
              'db.message.update.messages.update',
              () =>
                trx
                  .update(messages)
                  .set({
                    ...message,
                    ...(metadataToWrite && { metadata: metadataToWrite }),
                    ...(usageToWrite && { usage: usageToWrite }),
                  })
                  .where(and(eq(messages.id, id), this.ownership()))
                  .returning({ topicId: messages.topicId }),
              { hasMetadata: !!metadataPatch, valueKeys: Object.keys(message) },
            );

            matchedRow = !!updated;

            if (
              updated?.topicId && // When this write carries token usage (assistant finalize / hetero
              // step), recompute the topic's denormalized usage rollup from its
              // messages. Gated on the *incoming* payload so streaming
              // content-only updates don't trigger needless recomputes.
              usageToWrite
            ) {
              await runTimedStage(
                timing,
                'db.message.update.topic.recomputeUsage',
                () => recomputeTopicUsage(trx, this.userId, updated.topicId!, this.workspaceId),
                { topicCount: 1 },
              );
            }
          }),
        {
          hasImageList: !!imageList?.length,
          hasMetadata: shouldUpdateMetadata,
          valueKeys: Object.keys(message),
        },
      );

      if (!matchedRow) {
        console.error(`Update message error: no message matched id ${id}`);
        return { success: false };
      }

      return { success: true };
    } catch (error) {
      console.error('Update message error:', error);
      return { success: false };
    }
  };

  updateMetadata = async (id: string, metadata: Record<string, any>) => {
    const item = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), this.ownership()),
    });

    if (!item) return;

    const { usage: usageToWrite, ...metadataPatch } = metadata as Record<string, any>;
    const mergedMetadata = merge(item.metadata || {}, metadataPatch);
    if (usageToWrite) delete mergedMetadata.usage;

    return this.db
      .update(messages)
      .set({
        metadata: mergedMetadata,
        ...(usageToWrite && { usage: usageToWrite }),
      })
      .where(and(eq(messages.id, id), this.ownership()));
  };
}
