import type { LobeChatDatabase } from '@lobechat/database';
import { idGenerator } from '@lobechat/database';
import type { CreateMessageParams, DBMessageItem } from '@lobechat/types';
import { createTimingHelpers } from '@lobechat/utils';
import { and, eq, sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import type { CreateTopicParams } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import { agents, agentsToSessions, messages, topics } from '@/database/schemas';
import { FileService } from '@/server/services/file';
import { sanitizeNullBytes } from '@/utils/sanitizeNullBytes';

const { createPrefixedTimingContext, runTimedStage, toTimingContext } = createTimingHelpers(
  'lobe-server:chat:lobehub:timing',
);

interface GetMessagesAndTopicsParams {
  agentId?: string;
  current?: number;
  groupId?: string;
  includeTopic?: boolean;
  pageSize?: number;
  sessionId?: string;
  threadId?: string;
  timingRequestId?: string;
  timingStartedAt?: number;
  topicFilter?: {
    excludeStatuses?: string[];
    excludeTriggers?: string[];
    includeTriggers?: string[];
  };
  topicId?: string;
  topicPageSize?: number;
}

interface SimpleTurnMessage extends DBMessageItem {
  editorData?: CreateMessageParams['editorData'];
  groupId?: string | null;
  targetId?: string | null;
  usage?: CreateMessageParams['usage'] | null;
}

interface SimpleTurnMessageRow extends Omit<SimpleTurnMessage, 'createdAt' | 'updatedAt'> {
  createdAt: Date | string;
  resolvedSessionId: string | null;
  resolvedTopicId: string;
  updatedAt: Date | string;
}

interface CreateSimpleNewTopicTurnParams {
  agentId?: string | null;
  assistantMessage: Pick<CreateMessageParams, 'metadata' | 'model' | 'provider'> & {
    content: string;
  };
  groupId?: string | null;
  sessionId?: string | null;
  topic: Pick<CreateTopicParams, 'metadata' | 'title' | 'trigger'>;
  touchAgentUpdatedAt?: boolean;
  userMessage: Pick<CreateMessageParams, 'content' | 'editorData' | 'metadata'>;
}

interface CreateSimpleNewTopicTurnResult {
  assistantMessage: SimpleTurnMessage;
  resolvedSessionId: string | null;
  topicId: string;
  userMessage: SimpleTurnMessage;
}

interface CreateSimpleExistingTopicTurnParams {
  agentId?: string | null;
  assistantMessage: Pick<CreateMessageParams, 'metadata' | 'model' | 'provider'> & {
    content: string;
  };
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId: string;
  userMessage: Pick<CreateMessageParams, 'content' | 'editorData' | 'metadata' | 'parentId'>;
}

interface CreateSimpleExistingTopicTurnResult {
  assistantMessage: SimpleTurnMessage;
  resolvedSessionId: string | null;
  topicId: string;
  userMessage: SimpleTurnMessage;
}

const stringifyJsonParam = (value: unknown) =>
  value === undefined ? null : JSON.stringify(sanitizeNullBytes(value));

const toMessageItem = ({
  createdAt,
  resolvedSessionId: _resolvedSessionId,
  resolvedTopicId: _resolvedTopicId,
  updatedAt,
  ...message
}: SimpleTurnMessageRow): SimpleTurnMessage => ({
  ...message,
  createdAt: createdAt instanceof Date ? createdAt : new Date(createdAt),
  updatedAt: updatedAt instanceof Date ? updatedAt : new Date(updatedAt),
});

const getCreatedTurnMessages = (
  rows: SimpleTurnMessageRow[],
  userMessageId: string,
  assistantMessageId: string,
) => {
  const userMessage = rows.find((row) => row.id === userMessageId);
  const assistantMessage = rows.find((row) => row.id === assistantMessageId);

  return { assistantMessage, userMessage };
};

export class AiChatService {
  private userId: string;
  private serverDB: LobeChatDatabase;
  private messageModel: MessageModel;
  private fileService: FileService;
  private topicModel: TopicModel;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.serverDB = serverDB;

    this.messageModel = new MessageModel(serverDB, userId);
    this.topicModel = new TopicModel(serverDB, userId);
    this.fileService = new FileService(serverDB, userId);
  }

  async createSimpleNewTopicTurn({
    agentId,
    assistantMessage,
    groupId,
    sessionId,
    topic,
    touchAgentUpdatedAt = true,
    userMessage,
  }: CreateSimpleNewTopicTurnParams): Promise<CreateSimpleNewTopicTurnResult> {
    const normalizedAgentId = agentId ?? null;
    const normalizedGroupId = groupId ?? null;
    const normalizedSessionId = sessionId ?? null;
    const topicId = idGenerator('topics');
    const userMessageId = idGenerator('messages');
    const assistantMessageId = idGenerator('messages');
    const createdAt = Date.now();
    const userCreatedAt = new Date(createdAt);
    const assistantCreatedAt = new Date(createdAt + 1);
    const topicTitle = topic.title ?? null;
    const topicTrigger = topic.trigger ?? null;
    const userMetadata = stringifyJsonParam(userMessage.metadata);
    const userEditorData = stringifyJsonParam(userMessage.editorData);
    const assistantMetadata = stringifyJsonParam(assistantMessage.metadata);
    const topicMetadata = stringifyJsonParam(topic.metadata);

    const resolvedContext = this.serverDB.$with('resolved_context', {
      resolvedSessionId: sql<string | null>`"resolvedSessionId"`.as('resolvedSessionId'),
    }).as(sql`
        SELECT COALESCE(
          ${normalizedSessionId}::text,
          (
            SELECT ${agentsToSessions.sessionId}
            FROM ${agentsToSessions}
            WHERE ${agentsToSessions.agentId} = ${normalizedAgentId}
              AND ${agentsToSessions.userId} = ${this.userId}
            LIMIT 1
          )
        )::text AS "resolvedSessionId"
      `);

    const createdTopic = this.serverDB.$with('created_topic').as(
      this.serverDB
        .insert(topics)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`${topicId}::text`.as('id'),
              title: sql<string | null>`${topicTitle}::text`.as('title'),
              favorite: sql<boolean>`false`.as('favorite'),
              sessionId: resolvedContext.resolvedSessionId,
              content: sql<string | null>`NULL::text`.as('content'),
              editorData: sql<unknown | null>`NULL::jsonb`.as('editorData'),
              agentId: sql<string | null>`${normalizedAgentId}::text`.as('agentId'),
              groupId: sql<string | null>`${normalizedGroupId}::text`.as('groupId'),
              userId: sql<string>`${this.userId}::text`.as('userId'),
              clientId: sql<string | null>`NULL::text`.as('clientId'),
              description: sql<string | null>`NULL::text`.as('description'),
              historySummary: sql<string | null>`NULL::text`.as('historySummary'),
              metadata: sql<CreateTopicParams['metadata'] | null>`${topicMetadata}::jsonb`.as(
                'metadata',
              ),
              trigger: sql<CreateTopicParams['trigger'] | null>`${topicTrigger}::text`.as(
                'trigger',
              ),
              mode: sql<string | null>`NULL::text`.as('mode'),
              status: sql<string | null>`NULL::text`.as('status'),
              completedAt: sql<Date | null>`NULL::timestamp with time zone`.as('completedAt'),
              totalCost: sql<number | null>`NULL::numeric`.as('totalCost'),
              totalInputTokens: sql<number | null>`NULL::integer`.as('totalInputTokens'),
              totalOutputTokens: sql<number | null>`NULL::integer`.as('totalOutputTokens'),
              totalTokens: sql<number | null>`NULL::integer`.as('totalTokens'),
              cost: sql<Record<string, unknown> | null>`NULL::jsonb`.as('cost'),
              usage: sql<Record<string, unknown> | null>`NULL::jsonb`.as('usage'),
              model: sql<string | null>`NULL::text`.as('model'),
              provider: sql<string | null>`NULL::text`.as('provider'),
              senderId: sql<string | null>`NULL::text`.as('senderId'),
              accessedAt: sql<Date>`NOW()`.as('accessedAt'),
              createdAt: sql<Date>`NOW()`.as('createdAt'),
              updatedAt: sql<Date>`NOW()`.as('updatedAt'),
            })
            .from(resolvedContext),
        )
        .returning({ topicId: topics.id }),
    );

    const messagePayload = this.serverDB.$with('message_payload', {
      payloadContent: sql<string>`"payloadContent"`.as('payloadContent'),
      payloadCreatedAt: sql<Date>`"payloadCreatedAt"`.as('payloadCreatedAt'),
      payloadEditorData: sql<CreateMessageParams['editorData'] | null>`"payloadEditorData"`.as(
        'payloadEditorData',
      ),
      payloadId: sql<string>`"payloadId"`.as('payloadId'),
      payloadMetadata: sql<CreateMessageParams['metadata'] | null>`"payloadMetadata"`.as(
        'payloadMetadata',
      ),
      payloadModel: sql<string | null>`"payloadModel"`.as('payloadModel'),
      payloadParentId: sql<string | null>`"payloadParentId"`.as('payloadParentId'),
      payloadProvider: sql<string | null>`"payloadProvider"`.as('payloadProvider'),
      payloadRole: sql<string>`"payloadRole"`.as('payloadRole'),
      payloadUpdatedAt: sql<Date>`"payloadUpdatedAt"`.as('payloadUpdatedAt'),
    }).as(sql`
        SELECT *
        FROM (
          VALUES
            (
              ${userMessageId}::text,
              'user'::varchar,
              ${sanitizeNullBytes(userMessage.content)}::text,
              ${userEditorData}::jsonb,
              ${userMetadata}::jsonb,
              NULL::text,
              NULL::text,
              NULL::text,
              ${userCreatedAt}::timestamp with time zone,
              ${userCreatedAt}::timestamp with time zone
            ),
            (
              ${assistantMessageId}::text,
              'assistant'::varchar,
              ${sanitizeNullBytes(assistantMessage.content)}::text,
              NULL::jsonb,
              ${assistantMetadata}::jsonb,
              ${assistantMessage.model ?? null}::text,
              ${assistantMessage.provider ?? null}::text,
              ${userMessageId}::text,
              ${assistantCreatedAt}::timestamp with time zone,
              ${assistantCreatedAt}::timestamp with time zone
            )
        ) AS "payload" (
          "payloadId",
          "payloadRole",
          "payloadContent",
          "payloadEditorData",
          "payloadMetadata",
          "payloadModel",
          "payloadProvider",
          "payloadParentId",
          "payloadCreatedAt",
          "payloadUpdatedAt"
        )
      `);

    const createdMessages = this.serverDB.$with('created_messages').as(
      this.serverDB
        .insert(messages)
        .select((qb) =>
          qb
            .select({
              id: messagePayload.payloadId,
              role: messagePayload.payloadRole,
              content: messagePayload.payloadContent,
              editorData: messagePayload.payloadEditorData,
              summary: sql<string | null>`NULL::text`.as('summary'),
              reasoning: sql<unknown | null>`NULL::jsonb`.as('reasoning'),
              search: sql<unknown | null>`NULL::jsonb`.as('search'),
              metadata: messagePayload.payloadMetadata,
              usage: sql<CreateMessageParams['usage'] | null>`NULL::jsonb`.as('usage'),
              model: messagePayload.payloadModel,
              provider: messagePayload.payloadProvider,
              favorite: sql<boolean>`false`.as('favorite'),
              error: sql<unknown | null>`NULL::jsonb`.as('error'),
              tools: sql<unknown | null>`NULL::jsonb`.as('tools'),
              traceId: sql<string | null>`NULL::text`.as('traceId'),
              observationId: sql<string | null>`NULL::text`.as('observationId'),
              clientId: sql<string | null>`NULL::text`.as('clientId'),
              userId: sql<string>`${this.userId}::text`.as('userId'),
              sessionId: sql<string | null>`
                CASE
                  WHEN ${normalizedGroupId}::text IS NOT NULL THEN NULL
                  ELSE ${resolvedContext.resolvedSessionId}
                END
              `.as('sessionId'),
              topicId: createdTopic.topicId,
              threadId: sql<string | null>`NULL::text`.as('threadId'),
              parentId: messagePayload.payloadParentId,
              quotaId: sql<string | null>`NULL::text`.as('quotaId'),
              agentId: sql<string | null>`${normalizedAgentId}::text`.as('agentId'),
              groupId: sql<string | null>`${normalizedGroupId}::text`.as('groupId'),
              targetId: sql<string | null>`NULL::text`.as('targetId'),
              messageGroupId: sql<string | null>`NULL::text`.as('messageGroupId'),
              accessedAt: sql<Date>`NOW()`.as('accessedAt'),
              createdAt: messagePayload.payloadCreatedAt,
              updatedAt: messagePayload.payloadUpdatedAt,
            })
            .from(messagePayload)
            .crossJoin(resolvedContext)
            .crossJoin(createdTopic),
        )
        .returning(),
    );

    const touchedAgent = this.serverDB.$with('touched_agent').as(
      this.serverDB
        .update(agents)
        // accessedAt has $onUpdate; keep it unchanged to preserve the previous raw SQL behavior.
        .set({ accessedAt: agents.accessedAt, updatedAt: sql`NOW()` })
        .where(
          sql`${touchAgentUpdatedAt} AND ${normalizedAgentId}::text IS NOT NULL AND ${agents.id} = ${normalizedAgentId} AND ${agents.userId} = ${this.userId}`,
        )
        .returning({ id: agents.id }),
    );

    const rows = await this.serverDB
      .with(resolvedContext, createdTopic, messagePayload, createdMessages, touchedAgent)
      .select({
        agentId: createdMessages.agentId,
        clientId: createdMessages.clientId,
        content: sql<SimpleTurnMessage['content']>`${createdMessages.content}`.as('content'),
        createdAt: createdMessages.createdAt,
        editorData: sql<SimpleTurnMessage['editorData']>`${createdMessages.editorData}`.as(
          'editorData',
        ),
        error: sql<SimpleTurnMessage['error']>`${createdMessages.error}`.as('error'),
        favorite: createdMessages.favorite,
        groupId: createdMessages.groupId,
        id: createdMessages.id,
        metadata: sql<SimpleTurnMessage['metadata']>`${createdMessages.metadata}`.as('metadata'),
        model: createdMessages.model,
        observationId: createdMessages.observationId,
        parentId: createdMessages.parentId,
        provider: createdMessages.provider,
        quotaId: createdMessages.quotaId,
        reasoning: sql<SimpleTurnMessage['reasoning']>`${createdMessages.reasoning}`.as(
          'reasoning',
        ),
        role: sql<SimpleTurnMessage['role']>`${createdMessages.role}`.as('role'),
        search: sql<SimpleTurnMessage['search']>`${createdMessages.search}`.as('search'),
        sessionId: createdMessages.sessionId,
        targetId: createdMessages.targetId,
        threadId: createdMessages.threadId,
        tools: sql<SimpleTurnMessage['tools']>`${createdMessages.tools}`.as('tools'),
        topicId: createdMessages.topicId,
        traceId: createdMessages.traceId,
        updatedAt: createdMessages.updatedAt,
        usage: sql<SimpleTurnMessage['usage']>`${createdMessages.usage}`.as('usage'),
        userId: createdMessages.userId,
        resolvedSessionId: resolvedContext.resolvedSessionId,
        resolvedTopicId: createdTopic.topicId,
      })
      .from(createdMessages)
      .crossJoin(resolvedContext)
      .crossJoin(createdTopic);

    const { assistantMessage: assistantMessageRow, userMessage: userMessageRow } =
      getCreatedTurnMessages(rows, userMessageId, assistantMessageId);

    if (!userMessageRow || !assistantMessageRow) {
      throw new Error('Failed to create simple new topic turn');
    }

    return {
      assistantMessage: toMessageItem(assistantMessageRow),
      resolvedSessionId: userMessageRow.resolvedSessionId,
      topicId: userMessageRow.resolvedTopicId,
      userMessage: toMessageItem(userMessageRow),
    };
  }

  async createSimpleExistingTopicTurn({
    agentId,
    assistantMessage,
    groupId,
    sessionId,
    threadId,
    topicId,
    userMessage,
  }: CreateSimpleExistingTopicTurnParams): Promise<CreateSimpleExistingTopicTurnResult> {
    const normalizedAgentId = agentId ?? null;
    const normalizedGroupId = groupId ?? null;
    const normalizedSessionId = sessionId ?? null;
    const normalizedThreadId = threadId ?? null;
    const userParentId = userMessage.parentId ?? null;
    const userMessageId = idGenerator('messages');
    const assistantMessageId = idGenerator('messages');
    const createdAt = Date.now();
    const userCreatedAt = new Date(createdAt);
    const assistantCreatedAt = new Date(createdAt + 1);
    const userMetadata = stringifyJsonParam(userMessage.metadata);
    const userEditorData = stringifyJsonParam(userMessage.editorData);
    const assistantMetadata = stringifyJsonParam(assistantMessage.metadata);

    const existingTopic = this.serverDB.$with('existing_topic').as(
      this.serverDB
        .select({
          existingSessionId: topics.sessionId,
          existingTopicId: topics.id,
        })
        .from(topics)
        .where(and(eq(topics.id, topicId), eq(topics.userId, this.userId)))
        .limit(1),
    );

    const resolvedContext = this.serverDB.$with('resolved_context').as(
      this.serverDB
        .select({
          resolvedSessionId: sql<string | null>`
              COALESCE(
                ${normalizedSessionId}::text,
                ${existingTopic.existingSessionId},
                (
                  SELECT ${agentsToSessions.sessionId}
                  FROM ${agentsToSessions}
                  WHERE ${agentsToSessions.agentId} = ${normalizedAgentId}
                    AND ${agentsToSessions.userId} = ${this.userId}
                  LIMIT 1
                )
              )::text
            `.as('resolvedSessionId'),
          resolvedTopicId: existingTopic.existingTopicId,
        })
        .from(existingTopic),
    );

    const updatedTopic = this.serverDB.$with('updated_topic').as(
      this.serverDB
        .update(topics)
        // accessedAt has $onUpdate; keep it unchanged to preserve the previous raw SQL behavior.
        .set({ accessedAt: topics.accessedAt, updatedAt: sql`NOW()` })
        .from(resolvedContext)
        .where(and(eq(topics.id, resolvedContext.resolvedTopicId), eq(topics.userId, this.userId)))
        .returning({ topicId: topics.id }),
    );

    const messagePayload = this.serverDB.$with('message_payload', {
      payloadContent: sql<string>`"payloadContent"`.as('payloadContent'),
      payloadCreatedAt: sql<Date>`"payloadCreatedAt"`.as('payloadCreatedAt'),
      payloadEditorData: sql<CreateMessageParams['editorData'] | null>`"payloadEditorData"`.as(
        'payloadEditorData',
      ),
      payloadId: sql<string>`"payloadId"`.as('payloadId'),
      payloadMetadata: sql<CreateMessageParams['metadata'] | null>`"payloadMetadata"`.as(
        'payloadMetadata',
      ),
      payloadModel: sql<string | null>`"payloadModel"`.as('payloadModel'),
      payloadParentId: sql<string | null>`"payloadParentId"`.as('payloadParentId'),
      payloadProvider: sql<string | null>`"payloadProvider"`.as('payloadProvider'),
      payloadRole: sql<string>`"payloadRole"`.as('payloadRole'),
      payloadUpdatedAt: sql<Date>`"payloadUpdatedAt"`.as('payloadUpdatedAt'),
    }).as(sql`
        SELECT *
        FROM (
          VALUES
            (
              ${userMessageId}::text,
              'user'::varchar,
              ${sanitizeNullBytes(userMessage.content)}::text,
              ${userEditorData}::jsonb,
              ${userMetadata}::jsonb,
              NULL::text,
              NULL::text,
              ${userParentId}::text,
              ${userCreatedAt}::timestamp with time zone,
              ${userCreatedAt}::timestamp with time zone
            ),
            (
              ${assistantMessageId}::text,
              'assistant'::varchar,
              ${sanitizeNullBytes(assistantMessage.content)}::text,
              NULL::jsonb,
              ${assistantMetadata}::jsonb,
              ${assistantMessage.model ?? null}::text,
              ${assistantMessage.provider ?? null}::text,
              ${userMessageId}::text,
              ${assistantCreatedAt}::timestamp with time zone,
              ${assistantCreatedAt}::timestamp with time zone
            )
        ) AS "payload" (
          "payloadId",
          "payloadRole",
          "payloadContent",
          "payloadEditorData",
          "payloadMetadata",
          "payloadModel",
          "payloadProvider",
          "payloadParentId",
          "payloadCreatedAt",
          "payloadUpdatedAt"
        )
      `);

    const createdMessages = this.serverDB.$with('created_messages').as(
      this.serverDB
        .insert(messages)
        .select((qb) =>
          qb
            .select({
              id: messagePayload.payloadId,
              role: messagePayload.payloadRole,
              content: messagePayload.payloadContent,
              editorData: messagePayload.payloadEditorData,
              summary: sql<string | null>`NULL::text`.as('summary'),
              reasoning: sql<unknown | null>`NULL::jsonb`.as('reasoning'),
              search: sql<unknown | null>`NULL::jsonb`.as('search'),
              metadata: messagePayload.payloadMetadata,
              usage: sql<CreateMessageParams['usage'] | null>`NULL::jsonb`.as('usage'),
              model: messagePayload.payloadModel,
              provider: messagePayload.payloadProvider,
              favorite: sql<boolean>`false`.as('favorite'),
              error: sql<unknown | null>`NULL::jsonb`.as('error'),
              tools: sql<unknown | null>`NULL::jsonb`.as('tools'),
              traceId: sql<string | null>`NULL::text`.as('traceId'),
              observationId: sql<string | null>`NULL::text`.as('observationId'),
              clientId: sql<string | null>`NULL::text`.as('clientId'),
              userId: sql<string>`${this.userId}::text`.as('userId'),
              sessionId: sql<string | null>`
                CASE
                  WHEN ${normalizedGroupId}::text IS NOT NULL THEN NULL
                  ELSE ${resolvedContext.resolvedSessionId}
                END
              `.as('sessionId'),
              topicId: updatedTopic.topicId,
              threadId: sql<string | null>`${normalizedThreadId}::text`.as('threadId'),
              parentId: messagePayload.payloadParentId,
              quotaId: sql<string | null>`NULL::text`.as('quotaId'),
              agentId: sql<string | null>`${normalizedAgentId}::text`.as('agentId'),
              groupId: sql<string | null>`${normalizedGroupId}::text`.as('groupId'),
              targetId: sql<string | null>`NULL::text`.as('targetId'),
              messageGroupId: sql<string | null>`NULL::text`.as('messageGroupId'),
              accessedAt: sql<Date>`NOW()`.as('accessedAt'),
              createdAt: messagePayload.payloadCreatedAt,
              updatedAt: messagePayload.payloadUpdatedAt,
            })
            .from(messagePayload)
            .crossJoin(resolvedContext)
            .crossJoin(updatedTopic),
        )
        .returning(),
    );

    const rows = await this.serverDB
      .with(existingTopic, resolvedContext, updatedTopic, messagePayload, createdMessages)
      .select({
        agentId: createdMessages.agentId,
        clientId: createdMessages.clientId,
        content: sql<SimpleTurnMessage['content']>`${createdMessages.content}`.as('content'),
        createdAt: createdMessages.createdAt,
        editorData: sql<SimpleTurnMessage['editorData']>`${createdMessages.editorData}`.as(
          'editorData',
        ),
        error: sql<SimpleTurnMessage['error']>`${createdMessages.error}`.as('error'),
        favorite: createdMessages.favorite,
        groupId: createdMessages.groupId,
        id: createdMessages.id,
        metadata: sql<SimpleTurnMessage['metadata']>`${createdMessages.metadata}`.as('metadata'),
        model: createdMessages.model,
        observationId: createdMessages.observationId,
        parentId: createdMessages.parentId,
        provider: createdMessages.provider,
        quotaId: createdMessages.quotaId,
        reasoning: sql<SimpleTurnMessage['reasoning']>`${createdMessages.reasoning}`.as(
          'reasoning',
        ),
        role: sql<SimpleTurnMessage['role']>`${createdMessages.role}`.as('role'),
        search: sql<SimpleTurnMessage['search']>`${createdMessages.search}`.as('search'),
        sessionId: createdMessages.sessionId,
        targetId: createdMessages.targetId,
        threadId: createdMessages.threadId,
        tools: sql<SimpleTurnMessage['tools']>`${createdMessages.tools}`.as('tools'),
        topicId: createdMessages.topicId,
        traceId: createdMessages.traceId,
        updatedAt: createdMessages.updatedAt,
        usage: sql<SimpleTurnMessage['usage']>`${createdMessages.usage}`.as('usage'),
        userId: createdMessages.userId,
        resolvedSessionId: resolvedContext.resolvedSessionId,
        resolvedTopicId: updatedTopic.topicId,
      })
      .from(createdMessages)
      .crossJoin(resolvedContext)
      .crossJoin(updatedTopic);

    const { assistantMessage: assistantMessageRow, userMessage: userMessageRow } =
      getCreatedTurnMessages(rows, userMessageId, assistantMessageId);

    if (!userMessageRow || !assistantMessageRow) {
      throw new Error('Failed to create simple existing topic turn');
    }

    return {
      assistantMessage: toMessageItem(assistantMessageRow),
      resolvedSessionId: userMessageRow.resolvedSessionId,
      topicId: userMessageRow.resolvedTopicId,
      userMessage: toMessageItem(userMessageRow),
    };
  }

  async getMessagesAndTopics(params: GetMessagesAndTopicsParams) {
    const { topicFilter, topicPageSize, timingRequestId, timingStartedAt, ...messageParams } =
      params;
    const timingContext = toTimingContext({ timingRequestId, timingStartedAt });
    const messageTiming = createPrefixedTimingContext(
      timingContext,
      'lambda.aiChat.messagesAndTopics.messageModel.query',
    );
    const topicTiming = createPrefixedTimingContext(
      timingContext,
      'lambda.aiChat.messagesAndTopics.topicModel.query',
    );
    const messageQueryPromise = runTimedStage(
      timingContext,
      'lambda.aiChat.messagesAndTopics.messageModel.query',
      () =>
        this.messageModel.query(messageParams, {
          postProcessUrl: (path, file) =>
            this.fileService.getFileAccessUrl({ id: file.id, url: path }),
          ...(messageTiming ? { timing: messageTiming } : {}),
        }),
      {
        hasAgentId: !!params.agentId,
        hasThreadId: !!params.threadId,
        hasTopicId: !!params.topicId,
      },
    );
    const [messages, topics] = await Promise.all([
      messageQueryPromise,
      params.includeTopic
        ? runTimedStage(
            timingContext,
            'lambda.aiChat.messagesAndTopics.topicModel.query',
            () =>
              this.topicModel.query({
                agentId: params.agentId,
                groupId: params.groupId,
                pageSize: topicPageSize,
                ...(topicTiming ? { timing: topicTiming } : {}),
                ...topicFilter,
              }),
            { hasAgentId: !!params.agentId, hasGroupId: !!params.groupId },
          )
        : undefined,
    ]);

    return { messages, topics };
  }
}
