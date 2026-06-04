import type { LobeChatDatabase } from '@lobechat/database';
import { idGenerator } from '@lobechat/database';
import type { CreateMessageParams, DBMessageItem } from '@lobechat/types';
import { createTimingHelpers } from '@lobechat/utils';
import { sql } from 'drizzle-orm';

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

interface PersistedMessagePayload extends Omit<SimpleTurnMessage, 'createdAt' | 'updatedAt'> {
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface SimpleTurnRow extends Record<string, unknown> {
  assistantMessage: PersistedMessagePayload;
  resolvedSessionId: string | null;
  topicId: string;
  userMessage: PersistedMessagePayload;
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
  updatedAt,
  ...message
}: PersistedMessagePayload): SimpleTurnMessage => ({
  ...message,
  createdAt: createdAt instanceof Date ? createdAt : new Date(createdAt),
  updatedAt: updatedAt instanceof Date ? updatedAt : new Date(updatedAt),
});

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

    const result = await this.serverDB.execute<SimpleTurnRow>(sql`
          WITH resolved_context AS (
            SELECT COALESCE(
              ${normalizedSessionId},
              (
                SELECT "session_id"
                FROM ${agentsToSessions}
                WHERE "agent_id" = ${normalizedAgentId}
                  AND "user_id" = ${this.userId}
                LIMIT 1
              )
            )::text AS "session_id"
          ),
          created_topic AS (
            INSERT INTO ${topics} (
              "id",
              "title",
              "session_id",
              "agent_id",
              "group_id",
              "user_id",
              "metadata",
              "trigger"
            )
            SELECT
              ${topicId},
              ${topicTitle},
              "resolved_context"."session_id",
              ${normalizedAgentId},
              ${normalizedGroupId},
              ${this.userId},
              ${topicMetadata}::jsonb,
              ${topicTrigger}
            FROM "resolved_context"
            RETURNING "id"
          ),
          created_messages AS (
            INSERT INTO ${messages} (
              "id",
              "role",
              "content",
              "editor_data",
              "metadata",
              "model",
              "provider",
              "parent_id",
              "user_id",
              "session_id",
              "topic_id",
              "agent_id",
              "group_id",
              "created_at",
              "updated_at"
            )
            SELECT
              "payload"."id",
              "payload"."role",
              "payload"."content",
              "payload"."editor_data",
              "payload"."metadata",
              "payload"."model",
              "payload"."provider",
              "payload"."parent_id",
              ${this.userId},
              CASE
                WHEN ${normalizedGroupId}::text IS NOT NULL THEN NULL
                ELSE "resolved_context"."session_id"
              END,
              "created_topic"."id",
              ${normalizedAgentId},
              ${normalizedGroupId},
              "payload"."created_at",
              "payload"."updated_at"
            FROM "created_topic"
            CROSS JOIN "resolved_context"
            CROSS JOIN (
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
                  ${userCreatedAt}::timestamptz,
                  ${userCreatedAt}::timestamptz
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
                  ${assistantCreatedAt}::timestamptz,
                  ${assistantCreatedAt}::timestamptz
                )
            ) AS "payload" (
              "id",
              "role",
              "content",
              "editor_data",
              "metadata",
              "model",
              "provider",
              "parent_id",
              "created_at",
              "updated_at"
            )
            RETURNING *
          ),
          touched_agent AS (
            UPDATE ${agents}
            SET "updated_at" = NOW()
            WHERE ${touchAgentUpdatedAt}
              AND ${normalizedAgentId}::text IS NOT NULL
              AND "id" = ${normalizedAgentId}
              AND "user_id" = ${this.userId}
            RETURNING "id"
          )
          SELECT
            (SELECT "session_id" FROM "resolved_context") AS "resolvedSessionId",
            (SELECT "id" FROM "created_topic") AS "topicId",
            (SELECT COUNT(*) FROM "touched_agent") AS "touchedAgentCount",
            (
              SELECT jsonb_build_object(
                'agentId', "agent_id",
                'clientId', "client_id",
                'content', "content",
                'createdAt', "created_at",
                'editorData', "editor_data",
                'error', "error",
                'favorite', "favorite",
                'groupId', "group_id",
                'id', "id",
                'metadata', "metadata",
                'model', "model",
                'observationId', "observation_id",
                'parentId', "parent_id",
                'provider', "provider",
                'quotaId', "quota_id",
                'reasoning', "reasoning",
                'role', "role",
                'search', "search",
                'sessionId', "session_id",
                'targetId', "target_id",
                'threadId', "thread_id",
                'tools', "tools",
                'topicId', "topic_id",
                'traceId', "trace_id",
                'updatedAt', "updated_at",
                'usage', "usage",
                'userId', "user_id"
              )
              FROM "created_messages"
              WHERE "id" = ${userMessageId}
            ) AS "userMessage",
            (
              SELECT jsonb_build_object(
                'agentId', "agent_id",
                'clientId', "client_id",
                'content', "content",
                'createdAt', "created_at",
                'editorData', "editor_data",
                'error', "error",
                'favorite', "favorite",
                'groupId', "group_id",
                'id', "id",
                'metadata', "metadata",
                'model', "model",
                'observationId', "observation_id",
                'parentId', "parent_id",
                'provider', "provider",
                'quotaId', "quota_id",
                'reasoning', "reasoning",
                'role', "role",
                'search', "search",
                'sessionId', "session_id",
                'targetId', "target_id",
                'threadId', "thread_id",
                'tools', "tools",
                'topicId', "topic_id",
                'traceId', "trace_id",
                'updatedAt', "updated_at",
                'usage', "usage",
                'userId', "user_id"
              )
              FROM "created_messages"
              WHERE "id" = ${assistantMessageId}
            ) AS "assistantMessage"
        `);
    const [row] = result.rows;

    if (!row?.userMessage || !row.assistantMessage) {
      throw new Error('Failed to create simple new topic turn');
    }

    return {
      assistantMessage: toMessageItem(row.assistantMessage),
      resolvedSessionId: row.resolvedSessionId,
      topicId: row.topicId,
      userMessage: toMessageItem(row.userMessage),
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

    const result = await this.serverDB.execute<SimpleTurnRow>(sql`
          WITH existing_topic AS (
            SELECT "id", "session_id"
            FROM ${topics}
            WHERE "id" = ${topicId}
              AND "user_id" = ${this.userId}
            LIMIT 1
          ),
          resolved_context AS (
            SELECT
              "existing_topic"."id" AS "topic_id",
              COALESCE(
                ${normalizedSessionId}::text,
                "existing_topic"."session_id",
                (
                  SELECT "session_id"
                  FROM ${agentsToSessions}
                  WHERE "agent_id" = ${normalizedAgentId}
                    AND "user_id" = ${this.userId}
                  LIMIT 1
                )
              )::text AS "session_id"
            FROM "existing_topic"
          ),
          updated_topic AS (
            UPDATE ${topics}
            SET "updated_at" = NOW()
            WHERE "id" = (SELECT "topic_id" FROM "resolved_context")
              AND "user_id" = ${this.userId}
            RETURNING "id"
          ),
          created_messages AS (
            INSERT INTO ${messages} (
              "id",
              "role",
              "content",
              "editor_data",
              "metadata",
              "model",
              "provider",
              "parent_id",
              "user_id",
              "session_id",
              "topic_id",
              "thread_id",
              "agent_id",
              "group_id",
              "created_at",
              "updated_at"
            )
            SELECT
              "payload"."id",
              "payload"."role",
              "payload"."content",
              "payload"."editor_data",
              "payload"."metadata",
              "payload"."model",
              "payload"."provider",
              "payload"."parent_id",
              ${this.userId},
              CASE
                WHEN ${normalizedGroupId}::text IS NOT NULL THEN NULL
                ELSE "resolved_context"."session_id"
              END,
              "updated_topic"."id",
              ${normalizedThreadId}::text,
              ${normalizedAgentId},
              ${normalizedGroupId},
              "payload"."created_at",
              "payload"."updated_at"
            FROM "resolved_context"
            CROSS JOIN "updated_topic"
            CROSS JOIN (
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
                  ${userCreatedAt}::timestamptz,
                  ${userCreatedAt}::timestamptz
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
                  ${assistantCreatedAt}::timestamptz,
                  ${assistantCreatedAt}::timestamptz
                )
            ) AS "payload" (
              "id",
              "role",
              "content",
              "editor_data",
              "metadata",
              "model",
              "provider",
              "parent_id",
              "created_at",
              "updated_at"
            )
            RETURNING *
          )
          SELECT
            (SELECT "session_id" FROM "resolved_context") AS "resolvedSessionId",
            (SELECT "id" FROM "updated_topic") AS "topicId",
            (
              SELECT jsonb_build_object(
                'agentId', "agent_id",
                'clientId', "client_id",
                'content', "content",
                'createdAt', "created_at",
                'editorData', "editor_data",
                'error', "error",
                'favorite', "favorite",
                'groupId', "group_id",
                'id', "id",
                'metadata', "metadata",
                'model', "model",
                'observationId', "observation_id",
                'parentId', "parent_id",
                'provider', "provider",
                'quotaId', "quota_id",
                'reasoning', "reasoning",
                'role', "role",
                'search', "search",
                'sessionId', "session_id",
                'targetId', "target_id",
                'threadId', "thread_id",
                'tools', "tools",
                'topicId', "topic_id",
                'traceId', "trace_id",
                'updatedAt', "updated_at",
                'usage', "usage",
                'userId', "user_id"
              )
              FROM "created_messages"
              WHERE "id" = ${userMessageId}
            ) AS "userMessage",
            (
              SELECT jsonb_build_object(
                'agentId', "agent_id",
                'clientId', "client_id",
                'content', "content",
                'createdAt', "created_at",
                'editorData', "editor_data",
                'error', "error",
                'favorite', "favorite",
                'groupId', "group_id",
                'id', "id",
                'metadata', "metadata",
                'model', "model",
                'observationId', "observation_id",
                'parentId', "parent_id",
                'provider', "provider",
                'quotaId', "quota_id",
                'reasoning', "reasoning",
                'role', "role",
                'search', "search",
                'sessionId', "session_id",
                'targetId', "target_id",
                'threadId', "thread_id",
                'tools', "tools",
                'topicId', "topic_id",
                'traceId', "trace_id",
                'updatedAt', "updated_at",
                'usage', "usage",
                'userId', "user_id"
              )
              FROM "created_messages"
              WHERE "id" = ${assistantMessageId}
            ) AS "assistantMessage"
        `);
    const [row] = result.rows;

    if (!row?.topicId || !row.userMessage || !row.assistantMessage) {
      throw new Error('Failed to create simple existing topic turn');
    }

    return {
      assistantMessage: toMessageItem(row.assistantMessage),
      resolvedSessionId: row.resolvedSessionId,
      topicId: row.topicId,
      userMessage: toMessageItem(row.userMessage),
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
