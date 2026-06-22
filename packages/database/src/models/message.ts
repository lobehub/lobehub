import { INBOX_SESSION_ID } from '@lobechat/const';
import { parse } from '@lobechat/conversation-flow';
import type {
  ChatAudioItem,
  ChatFileItem,
  ChatImageItem,
  ChatToolPayload,
  ChatTranslate,
  ChatTTS,
  ChatVideoItem,
  CreateMessageParams,
  DBMessageItem,
  IThreadType,
  MessagePluginItem,
  ModelRankItem,
  ModelUsage,
  NewMessageQueryParams,
  QueryMessageParams,
  TaskDetail,
  ThreadStatus,
  UIChatMessage,
  UpdateMessageParams,
  UpdateMessageRAGParams,
} from '@lobechat/types';
import { MessageGroupType, ThreadType } from '@lobechat/types';
import type { TimingSink } from '@lobechat/utils';
import {
  getDurationMs,
  logTimingSink as logTiming,
  runTimedSinkStage as runTimedStage,
} from '@lobechat/utils';
import type { HeatmapsProps } from '@lobehub/charts';
import dayjs from 'dayjs';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
} from 'drizzle-orm';

import { merge } from '@/utils/merge';
import { sanitizeNullBytes } from '@/utils/sanitizeNullBytes';
import { today } from '@/utils/time';

import {
  agentsToSessions,
  chunks,
  documents,
  embeddings,
  fileChunks,
  files,
  messageGroups,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
  threads,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { sanitizeBm25Query } from '../utils/bm25';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { recomputeTopicUsage } from './topicUsage';

/**
 * Options for querying messages with relations
 */
export interface QueryMessagesOptions {
  /**
   * Current page number (0-indexed)
   */
  current?: number;
  /**
   * Number of messages per page
   */
  pageSize?: number;
  /**
   * Post-process function for file URLs
   */
  postProcessUrl?: (
    path: string | null,
    file: { fileType: string; id?: string | null },
  ) => Promise<string>;
  timing?: ModelTimingContext;
  /**
   * Topic ID for MessageGroup aggregation queries
   */
  topicId?: string;
  /**
   * Custom where condition for message filtering
   */
  where?: SQL;
}

export interface ModelTimingContext extends TimingSink {}

interface MessageRelatedFile {
  fileType: string | null;
  id: string;
  messageId: string;
  name: string | null;
  size: number | null;
  url: string;
}

interface MessageChunkRelation {
  fileId: string;
  filename: string | null;
  fileType: string | null;
  fileUrl: string | null;
  id: string | null;
  messageId: string | null;
  similarity: string | null;
  text: string | null;
}

interface MessageQueryRelation {
  id: string;
  messageId: string;
  rewriteQuery: string | null;
  userQuery: string | null;
}

interface MessageThreadRelation {
  metadata: unknown;
  sourceMessageId: string | null;
  status: string | null;
  threadId: string;
  title: string | null;
}

interface MessageFileRelations {
  documentsMap: Record<string, string>;
  relatedFileList: MessageRelatedFile[];
}

interface CreateUserAndAssistantMessagesParams {
  assistantMessage: CreateMessageParams;
  userMessage: CreateMessageParams;
}

interface CreateUserAndAssistantMessagesOptions {
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
  pluginIntervention?: CreateMessageParams['pluginIntervention'];
  pluginState?: CreateMessageParams['pluginState'];
  ragQueryId?: CreateMessageParams['ragQueryId'];
}

interface SplitCreateMessageParams {
  insert: CreateMessageInsertParams;
  relations: CreateMessageRelationParams;
}

export class MessageModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);

  private pluginsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messagePlugins);

  private translatesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageTranslates);

  private ttsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageTTS);

  private agentsToSessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsToSessions);

  // **************** Query *************** //

  /**
   * Query messages by params (high-level API)
   *
   * This is the main query method that handles common query patterns.
   * For custom queries, use `queryWithWhere` directly.
   */
  query = async (
    {
      agentId,
      current = 0,
      pageSize = 1000,
      sessionId,
      topicId,
      groupId,
      threadId,
    }: QueryMessageParams = {},
    options: {
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
      timing?: ModelTimingContext;
    } = {},
  ) => {
    const queryStartedAt = Date.now();
    const timing = options.timing;
    logTiming(timing, 'db.message.query:start', {
      current,
      hasAgentId: !!agentId,
      hasGroupId: !!groupId,
      hasSessionId: !!sessionId,
      hasThreadId: !!threadId,
      hasTopicId: !!topicId,
      pageSize,
    });

    // Build agent condition (handles legacy sessionId lookup)
    let agentCondition: SQL | undefined;
    if (agentId) {
      agentCondition = await runTimedStage(
        timing,
        'db.message.query.buildAgentCondition',
        () => this.buildAgentCondition(agentId),
        { hasAgentId: true },
      );
    } else if (sessionId) {
      agentCondition = this.matchSession(sessionId);
    }

    // For thread queries, we need to fetch complete thread data (parent + thread messages)
    if (threadId) {
      const threadCondition = await runTimedStage(
        timing,
        'db.message.query.buildThreadCondition',
        () => this.buildThreadQueryCondition(threadId),
        { hasThreadId: true },
      );
      const messageItems = await this.queryWithWhere({
        current,
        pageSize,
        postProcessUrl: options.postProcessUrl,
        timing,
        // Thread queries optionally add agent/session scope if provided
        where: agentCondition ? and(agentCondition, threadCondition) : threadCondition,
      });
      logTiming(timing, 'db.message.query:done', {
        messageCount: messageItems.length,
        stageMs: getDurationMs(queryStartedAt),
      });
      return messageItems;
    }

    // For Group Chat queries: filter by groupId only (not agentId)
    // In Group Chat, all messages (user, supervisor, workers) should have groupId
    // and may have different agentIds, so we only filter by groupId + topicId
    if (groupId) {
      const whereCondition = and(
        eq(messages.groupId, groupId),
        this.matchTopic(topicId),
        this.matchThread(threadId),
      );

      const messageItems = await this.queryWithWhere({
        current,
        pageSize,
        postProcessUrl: options.postProcessUrl,
        timing,
        topicId: topicId ?? undefined,
        where: whereCondition,
      });
      logTiming(timing, 'db.message.query:done', {
        messageCount: messageItems.length,
        stageMs: getDurationMs(queryStartedAt),
      });
      return messageItems;
    }

    // Standard query with session/topic/group filters
    const whereCondition = and(
      agentCondition ?? this.matchSession(sessionId),
      this.matchTopic(topicId),
      this.matchGroup(groupId),
      this.matchThread(threadId),
    );

    const messageItems = await this.queryWithWhere({
      current,
      pageSize,
      postProcessUrl: options.postProcessUrl,
      timing,
      topicId: topicId ?? undefined,
      where: whereCondition,
    });
    logTiming(timing, 'db.message.query:done', {
      messageCount: messageItems.length,
      stageMs: getDurationMs(queryStartedAt),
    });
    return messageItems;
  };

  /**
   * Query messages with full relations (files, plugins, translations, etc.)
   *
   * This is the low-level query method that accepts a custom where condition.
   * Use this for building custom query scenarios.
   *
   * Features:
   * - Filters out messages that belong to MessageGroups (compression/parallel)
   * - Includes MessageGroup nodes (compressedGroup/compareGroup) in the result
   * - compressedGroup nodes include pinnedMessages array (favorite=true messages)
   * - compareGroup nodes include children array (parallel messages)
   *
   * @param options - Query options including where condition and pagination
   * @returns Messages with all related data, including MessageGroup nodes
   */
  queryWithWhere = async (options: QueryMessagesOptions = {}): Promise<UIChatMessage[]> => {
    const { where, current = 0, pageSize = 1000, postProcessUrl, topicId, timing } = options;
    const totalStartedAt = Date.now();
    const offset = current * pageSize;

    // 1. get basic messages with joins, excluding messages that belong to MessageGroups
    const result = await runTimedStage(
      timing,
      'db.message.queryWithWhere.baseSelect',
      () =>
        this.db
          .select({
            id: messages.id,
            role: messages.role,
            content: messages.content,
            editorData: messages.editorData,
            reasoning: messages.reasoning,
            search: messages.search,
            metadata: messages.metadata,
            usage: messages.usage,
            error: messages.error,

            model: messages.model,
            provider: messages.provider,

            createdAt: messages.createdAt,
            updatedAt: messages.updatedAt,

            sessionId: messages.sessionId,
            topicId: messages.topicId,
            parentId: messages.parentId,
            threadId: messages.threadId,

            // Group chat fields
            groupId: messages.groupId,
            agentId: messages.agentId,
            targetId: messages.targetId,

            tools: messages.tools,
            tool_call_id: messagePlugins.toolCallId,

            plugin: {
              apiName: messagePlugins.apiName,
              arguments: messagePlugins.arguments,
              identifier: messagePlugins.identifier,
              type: messagePlugins.type,
            },
            pluginError: messagePlugins.error,
            pluginIntervention: messagePlugins.intervention,
            pluginState: messagePlugins.state,

            translate: {
              content: messageTranslates.content,
              from: messageTranslates.from,
              to: messageTranslates.to,
            },

            ttsId: messageTTS.id,
            ttsContentMd5: messageTTS.contentMd5,
            ttsFile: messageTTS.fileId,
            ttsVoice: messageTTS.voice,
          })
          .from(messages)
          .where(
            and(
              this.ownership(),
              // Filter out messages that belong to MessageGroups
              isNull(messages.messageGroupId),
              where,
            ),
          )
          .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
          .leftJoin(messageTranslates, eq(messageTranslates.id, messages.id))
          .leftJoin(messageTTS, eq(messageTTS.id, messages.id))
          .orderBy(asc(messages.createdAt))
          .limit(pageSize)
          .offset(offset),
      { current, pageSize },
    );
    logTiming(timing, 'db.message.queryWithWhere.baseSelect:rows', { rowCount: result.length });

    const messageIds = result.map((message) => message.id as string);

    const messageGroupNodesPromise = this.queryMessageGroupNodesForPage({
      current,
      postProcessUrl,
      result,
      timing,
      topicId,
    });

    const taskMessageIds = result
      .filter((message) => message.role === 'task')
      .map((message) => {
        return message.id as string;
      });

    const [
      messageGroupNodes,
      { documentsMap, relatedFileList },
      chunksList,
      messageQueriesList,
      threadData,
    ] = await Promise.all([
      messageGroupNodesPromise,
      this.queryMessageFileRelations(messageIds, postProcessUrl, timing),
      this.queryMessageChunkRelations(messageIds, timing),
      this.queryMessageQueryRelations(messageIds, timing),
      this.queryMessageThreadRelations(taskMessageIds, timing),
    ]);

    if (messageIds.length === 0 && messageGroupNodes.length === 0) {
      logTiming(timing, 'db.message.queryWithWhere:done', {
        messageGroupCount: 0,
        rowCount: 0,
        stageMs: getDurationMs(totalStartedAt),
      });
      return [];
    }

    const imageList = relatedFileList.filter((i) => (i.fileType || '').startsWith('image'));
    const videoList = relatedFileList.filter((i) => (i.fileType || '').startsWith('video'));
    const audioList = relatedFileList.filter((i) => (i.fileType || '').startsWith('audio'));
    const fileList = relatedFileList.filter(
      (i) =>
        !(i.fileType || '').startsWith('image') &&
        !(i.fileType || '').startsWith('video') &&
        !(i.fileType || '').startsWith('audio'),
    );

    const threadMap = this.createThreadMap(threadData);

    // 6. Transform regular messages
    const transformedMessages = await runTimedStage(
      timing,
      'db.message.queryWithWhere.transform',
      () =>
        result.map(
          ({ model, provider, translate, ttsId, ttsFile, ttsContentMd5, ttsVoice, ...item }) => {
            const messageQuery = messageQueriesList.find(
              (relation) => relation.messageId === item.id,
            );
            return {
              ...item,
              chunksList: chunksList
                .filter((relation) => relation.messageId === item.id)
                .map((c) => ({
                  ...c,
                  similarity: c.similarity === null ? undefined : Number(c.similarity),
                })),

              extra: {
                model,
                provider,
                translate,
                tts: ttsId
                  ? {
                      contentMd5: ttsContentMd5,
                      file: ttsFile,
                      voice: ttsVoice,
                    }
                  : undefined,
              },
              fileList: fileList
                .filter((relation) => relation.messageId === item.id)

                .map<ChatFileItem>(({ id, url, size, fileType, name }) => ({
                  content: documentsMap[id],
                  fileType: fileType!,
                  id,
                  name: name!,
                  size: size!,
                  url,
                })),
              imageList: imageList
                .filter((relation) => relation.messageId === item.id)

                .map<ChatImageItem>(({ id, url, name }) => ({ alt: name!, id, url })),

              model,

              provider,
              ragQuery: messageQuery?.rewriteQuery,
              ragQueryId: messageQuery?.id,
              ragRawQuery: messageQuery?.userQuery,
              // Add taskDetail for task messages
              taskDetail: item.role === 'task' ? threadMap.get(item.id as string) : undefined,
              // Prefer the dedicated `usage` column, falling back to legacy
              // `metadata.usage` for rows written before the migration.
              usage: item.usage ?? (item.metadata as { usage?: ModelUsage } | null)?.usage,
              videoList: videoList
                .filter((relation) => relation.messageId === item.id)

                .map<ChatVideoItem>(({ id, url, name }) => ({ alt: name!, id, url })),
              audioList: audioList
                .filter((relation) => relation.messageId === item.id)

                .map<ChatAudioItem>(({ id, url, name }) => ({ alt: name!, id, url })),
            } as unknown as UIChatMessage;
          },
        ),
      {
        chunkCount: chunksList.length,
        fileCount: relatedFileList.length,
        messageQueryCount: messageQueriesList.length,
        rowCount: result.length,
      },
    );

    // 7. Merge regular messages with MessageGroup nodes and sort by createdAt
    const allItems = [...transformedMessages, ...messageGroupNodes];
    allItems.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return aTime - bTime;
    });

    logTiming(timing, 'db.message.queryWithWhere:done', {
      messageGroupCount: messageGroupNodes.length,
      resultCount: allItems.length,
      rowCount: result.length,
      stageMs: getDurationMs(totalStartedAt),
    });

    return allItems;
  };

  private queryMessageGroupNodesForPage = async ({
    current,
    postProcessUrl,
    result,
    timing,
    topicId,
  }: {
    current: number;
    postProcessUrl?: (
      path: string | null,
      file: { fileType: string; id?: string | null },
    ) => Promise<string>;
    result: { createdAt: Date }[];
    timing?: ModelTimingContext;
    topicId?: string;
  }): Promise<UIChatMessage[]> => {
    if (!topicId) return [];

    if (result.length === 0) {
      if (current !== 0) return [];

      return runTimedStage(
        timing,
        'db.message.queryWithWhere.messageGroups',
        () => this.queryMessageGroupNodes(topicId, undefined, postProcessUrl, timing),
        { current, hasMessages: false, topicId },
      );
    }

    if (current === 0) {
      return runTimedStage(
        timing,
        'db.message.queryWithWhere.messageGroups',
        () => this.queryMessageGroupNodes(topicId, undefined, postProcessUrl, timing),
        { current, hasMessages: true, topicId },
      );
    }

    const firstMessageTime = result[0].createdAt;
    const lastMessageTime = result.at(-1)!.createdAt;

    return runTimedStage(
      timing,
      'db.message.queryWithWhere.messageGroups',
      () =>
        this.queryMessageGroupNodes(
          topicId,
          {
            endTime: lastMessageTime,
            startTime: firstMessageTime,
          },
          postProcessUrl,
          timing,
        ),
      { current, hasMessages: true, topicId },
    );
  };

  private queryMessageFileRelations = async (
    messageIds: string[],
    postProcessUrl: QueryMessagesOptions['postProcessUrl'],
    timing?: ModelTimingContext,
  ): Promise<MessageFileRelations> => {
    if (messageIds.length === 0) return { documentsMap: {}, relatedFileList: [] };

    const rawRelatedFileList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.relatedFiles.select',
      () =>
        this.db
          .select({
            fileType: files.fileType,
            id: messagesFiles.fileId,
            messageId: messagesFiles.messageId,
            name: files.name,
            size: files.size,
            url: files.url,
          })
          .from(messagesFiles)
          .leftJoin(files, eq(files.id, messagesFiles.fileId))
          .where(inArray(messagesFiles.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.relatedFiles.select:rows', {
      rowCount: rawRelatedFileList.length,
    });

    const relatedFileList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.relatedFiles.postProcess',
      () =>
        Promise.all(
          rawRelatedFileList.map(async (file) => ({
            ...file,
            url: postProcessUrl
              ? await postProcessUrl(
                  file.url,
                  file as unknown as { fileType: string; id?: string | null },
                )
              : (file.url as string),
          })),
        ),
      { fileCount: rawRelatedFileList.length },
    );

    const fileIds = relatedFileList.map((file) => file.id).filter(Boolean);

    if (fileIds.length === 0) return { documentsMap: {}, relatedFileList };

    const documentsList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.documents.select',
      () =>
        this.db
          .select({
            content: documents.content,
            fileId: documents.fileId,
          })
          .from(documents)
          .where(inArray(documents.fileId, fileIds)),
      { fileCount: fileIds.length },
    );

    const documentsMap = documentsList.reduce(
      (acc, doc) => {
        if (doc.fileId) acc[doc.fileId] = doc.content as string;
        return acc;
      },
      {} as Record<string, string>,
    );

    return { documentsMap, relatedFileList };
  };

  private queryMessageChunkRelations = async (
    messageIds: string[],
    timing?: ModelTimingContext,
  ): Promise<MessageChunkRelation[]> => {
    if (messageIds.length === 0) return [];

    const chunksList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.chunks.select',
      () =>
        this.db
          .select({
            fileId: files.id,
            fileType: files.fileType,
            fileUrl: files.url,
            filename: files.name,
            id: chunks.id,
            messageId: messageQueryChunks.messageId,
            similarity: messageQueryChunks.similarity,
            text: chunks.text,
          })
          .from(messageQueryChunks)
          .leftJoin(chunks, eq(chunks.id, messageQueryChunks.chunkId))
          .leftJoin(fileChunks, eq(fileChunks.chunkId, chunks.id))
          .innerJoin(files, eq(fileChunks.fileId, files.id))
          .where(inArray(messageQueryChunks.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.chunks.select:rows', {
      rowCount: chunksList.length,
    });

    return chunksList;
  };

  private queryMessageQueryRelations = async (
    messageIds: string[],
    timing?: ModelTimingContext,
  ): Promise<MessageQueryRelation[]> => {
    if (messageIds.length === 0) return [];

    const messageQueriesList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.messageQueries.select',
      () =>
        this.db
          .select({
            id: messageQueries.id,
            messageId: messageQueries.messageId,
            rewriteQuery: messageQueries.rewriteQuery,
            userQuery: messageQueries.userQuery,
          })
          .from(messageQueries)
          .where(inArray(messageQueries.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.messageQueries.select:rows', {
      rowCount: messageQueriesList.length,
    });

    return messageQueriesList;
  };

  private queryMessageThreadRelations = async (
    taskMessageIds: string[],
    timing?: ModelTimingContext,
  ): Promise<MessageThreadRelation[]> => {
    if (taskMessageIds.length === 0) return [];

    return runTimedStage(
      timing,
      'db.message.queryWithWhere.taskThreads.select',
      () =>
        this.db
          .select({
            metadata: threads.metadata,
            sourceMessageId: threads.sourceMessageId,
            status: threads.status,
            threadId: threads.id,
            title: threads.title,
          })
          .from(threads)
          .where(
            and(
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
              inArray(threads.sourceMessageId, taskMessageIds),
            ),
          ),
      { taskMessageCount: taskMessageIds.length },
    );
  };

  private createThreadMap = (threadData: MessageThreadRelation[]) =>
    new Map<string, TaskDetail>(
      threadData.map((thread) => {
        const metadata = thread.metadata as Record<string, unknown> | null;
        return [
          thread.sourceMessageId!,
          {
            clientMode: metadata?.clientMode as boolean | undefined,
            duration: metadata?.duration as number | undefined,
            status: thread.status as ThreadStatus,
            threadId: thread.threadId,
            title: thread.title ?? undefined,
            totalCost: metadata?.totalCost as number | undefined,
            totalMessages: metadata?.totalMessages as number | undefined,
            totalTokens: metadata?.totalTokens as number | undefined,
            totalToolCalls: metadata?.totalToolCalls as number | undefined,
          },
        ];
      }),
    );

  /**
   * Query messages by their IDs with full relations
   *
   * This is useful for getting full message data when you already have the IDs.
   * It reuses the same transformation logic as queryWithWhere.
   *
   * @param messageIds - Array of message IDs to query
   * @param options - Query options (postProcessUrl for file URL transformation)
   * @returns Messages with all related data (files, plugins, translations, etc.)
   */
  queryByIds = async (
    messageIds: string[],
    options: {
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
    } = {},
  ): Promise<UIChatMessage[]> => {
    if (messageIds.length === 0) return [];

    const { postProcessUrl } = options;

    // 1. Query messages with joins
    const result = await this.db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        editorData: messages.editorData,
        reasoning: messages.reasoning,
        search: messages.search,
        metadata: messages.metadata,
        usage: messages.usage,
        error: messages.error,

        model: messages.model,
        provider: messages.provider,

        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,

        sessionId: messages.sessionId,
        topicId: messages.topicId,
        parentId: messages.parentId,
        threadId: messages.threadId,

        // Group chat fields
        groupId: messages.groupId,
        agentId: messages.agentId,
        targetId: messages.targetId,

        tools: messages.tools,
        tool_call_id: messagePlugins.toolCallId,

        plugin: {
          apiName: messagePlugins.apiName,
          arguments: messagePlugins.arguments,
          identifier: messagePlugins.identifier,
          type: messagePlugins.type,
        },
        pluginError: messagePlugins.error,
        pluginIntervention: messagePlugins.intervention,
        pluginState: messagePlugins.state,

        translate: {
          content: messageTranslates.content,
          from: messageTranslates.from,
          to: messageTranslates.to,
        },

        ttsId: messageTTS.id,
        ttsContentMd5: messageTTS.contentMd5,
        ttsFile: messageTTS.fileId,
        ttsVoice: messageTTS.voice,
      })
      .from(messages)
      .where(and(this.ownership(), inArray(messages.id, messageIds)))
      .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .leftJoin(messageTranslates, eq(messageTranslates.id, messages.id))
      .leftJoin(messageTTS, eq(messageTTS.id, messages.id))
      .orderBy(asc(messages.createdAt));

    if (result.length === 0) return [];

    // 2. Run parallel queries for better performance
    const taskMessageIds = result.filter((m) => m.role === 'task').map((m) => m.id as string);

    const [rawRelatedFileList, chunksList, messageQueriesList, threadData] = await Promise.all([
      // 2a. Get related files
      this.db
        .select({
          fileType: files.fileType,
          id: messagesFiles.fileId,
          messageId: messagesFiles.messageId,
          name: files.name,
          size: files.size,
          url: files.url,
        })
        .from(messagesFiles)
        .leftJoin(files, eq(files.id, messagesFiles.fileId))
        .where(inArray(messagesFiles.messageId, messageIds)),

      // 2b. Get related file chunks
      this.db
        .select({
          fileId: files.id,
          fileType: files.fileType,
          fileUrl: files.url,
          filename: files.name,
          id: chunks.id,
          messageId: messageQueryChunks.messageId,
          similarity: messageQueryChunks.similarity,
          text: chunks.text,
        })
        .from(messageQueryChunks)
        .leftJoin(chunks, eq(chunks.id, messageQueryChunks.chunkId))
        .leftJoin(fileChunks, eq(fileChunks.chunkId, chunks.id))
        .innerJoin(files, eq(fileChunks.fileId, files.id))
        .where(inArray(messageQueryChunks.messageId, messageIds)),

      // 2c. Get related message queries (RAG)
      this.db
        .select({
          id: messageQueries.id,
          messageId: messageQueries.messageId,
          rewriteQuery: messageQueries.rewriteQuery,
          userQuery: messageQueries.userQuery,
        })
        .from(messageQueries)
        .where(inArray(messageQueries.messageId, messageIds)),

      // 2d. Get thread info for task messages
      taskMessageIds.length > 0
        ? this.db
            .select({
              metadata: threads.metadata,
              sourceMessageId: threads.sourceMessageId,
              status: threads.status,
              threadId: threads.id,
              title: threads.title,
            })
            .from(threads)
            .where(
              and(
                buildWorkspaceWhere(
                  { userId: this.userId, workspaceId: this.workspaceId },
                  threads,
                ),
                inArray(threads.sourceMessageId, taskMessageIds),
              ),
            )
        : Promise.resolve([]),
    ]);

    // 3. Process file results
    const relatedFileList = await Promise.all(
      rawRelatedFileList.map(async (file) => ({
        ...file,
        url: postProcessUrl
          ? await postProcessUrl(
              file.url,
              file as unknown as { fileType: string; id?: string | null },
            )
          : (file.url as string),
      })),
    );

    // Get associated document content
    const fileIds = relatedFileList.map((file) => file.id).filter(Boolean);

    let documentsMap: Record<string, string> = {};

    if (fileIds.length > 0) {
      const documentsList = await this.db
        .select({
          content: documents.content,
          fileId: documents.fileId,
        })
        .from(documents)
        .where(inArray(documents.fileId, fileIds));

      documentsMap = documentsList.reduce(
        (acc, doc) => {
          if (doc.fileId) acc[doc.fileId] = doc.content as string;
          return acc;
        },
        {} as Record<string, string>,
      );
    }

    const imageList = relatedFileList.filter((i) => (i.fileType || '').startsWith('image'));
    const videoList = relatedFileList.filter((i) => (i.fileType || '').startsWith('video'));
    const audioList = relatedFileList.filter((i) => (i.fileType || '').startsWith('audio'));
    const fileList = relatedFileList.filter(
      (i) =>
        !(i.fileType || '').startsWith('image') &&
        !(i.fileType || '').startsWith('video') &&
        !(i.fileType || '').startsWith('audio'),
    );

    // 4. Build thread map
    const threadMap = new Map(
      threadData.map((t) => {
        const metadata = t.metadata as Record<string, unknown> | null;
        return [
          t.sourceMessageId!,
          {
            clientMode: metadata?.clientMode as boolean | undefined,
            duration: metadata?.duration as number | undefined,
            status: t.status as ThreadStatus,
            threadId: t.threadId,
            title: t.title ?? undefined,
            totalCost: metadata?.totalCost as number | undefined,
            totalMessages: metadata?.totalMessages as number | undefined,
            totalTokens: metadata?.totalTokens as number | undefined,
            totalToolCalls: metadata?.totalToolCalls as number | undefined,
          },
        ];
      }),
    );

    // 6. Transform messages to UIChatMessage format
    return result.map(
      ({ model, provider, translate, ttsId, ttsFile, ttsContentMd5, ttsVoice, ...item }) => {
        const messageQuery = messageQueriesList.find((relation) => relation.messageId === item.id);
        return {
          ...item,
          chunksList: chunksList
            .filter((relation) => relation.messageId === item.id)
            .map((c) => ({
              ...c,
              similarity: c.similarity === null ? undefined : Number(c.similarity),
            })),

          extra: {
            model,
            provider,
            translate,
            tts: ttsId
              ? {
                  contentMd5: ttsContentMd5,
                  file: ttsFile,
                  voice: ttsVoice,
                }
              : undefined,
          },
          fileList: fileList
            .filter((relation) => relation.messageId === item.id)
            .map<ChatFileItem>(({ id, url, size, fileType, name }) => ({
              content: documentsMap[id],
              fileType: fileType!,
              id,
              name: name!,
              size: size!,
              url,
            })),
          imageList: imageList
            .filter((relation) => relation.messageId === item.id)
            .map<ChatImageItem>(({ id, url, name }) => ({ alt: name!, id, url })),

          model,

          provider,
          ragQuery: messageQuery?.rewriteQuery,
          ragQueryId: messageQuery?.id,
          ragRawQuery: messageQuery?.userQuery,
          // Add taskDetail for task messages
          taskDetail: item.role === 'task' ? threadMap.get(item.id as string) : undefined,
          // Prefer the dedicated `usage` column, falling back to legacy
          // `metadata.usage` for rows written before the migration.
          usage: item.usage ?? (item.metadata as { usage?: ModelUsage } | null)?.usage,
          videoList: videoList
            .filter((relation) => relation.messageId === item.id)
            .map<ChatVideoItem>(({ id, url, name }) => ({ alt: name!, id, url })),
          audioList: audioList
            .filter((relation) => relation.messageId === item.id)
            .map<ChatAudioItem>(({ id, url, name }) => ({ alt: name!, id, url })),
        } as unknown as UIChatMessage;
      },
    );
  };

  /**
   * Query MessageGroup nodes for a topic
   * - compressedGroup: includes pinnedMessages and compressedMessages arrays
   * - compareGroup: includes children array
   *
   * @param topicId - The topic ID to query groups for
   * @param timeRange - Optional time range to filter groups (for pagination support)
   */
  private queryMessageGroupNodes = async (
    topicId: string,
    timeRange?: { endTime: Date; startTime: Date },
    postProcessUrl?: (
      path: string | null,
      file: { fileType: string; id?: string | null },
    ) => Promise<string>,
    timing?: ModelTimingContext,
  ): Promise<UIChatMessage[]> => {
    // 1. Query MessageGroups for this topic, optionally filtered by time range
    const whereConditions = [
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageGroups),
      eq(messageGroups.topicId, topicId),
    ];

    // Add time range filter if provided (for pagination)
    if (timeRange) {
      whereConditions.push(
        gte(messageGroups.createdAt, timeRange.startTime),
        lte(messageGroups.createdAt, timeRange.endTime),
      );
    }

    const groups = await runTimedStage(
      timing,
      'db.message.messageGroups.groups.select',
      () =>
        this.db
          .select()
          .from(messageGroups)
          .where(and(...whereConditions))
          .orderBy(asc(messageGroups.createdAt)),
      { hasTimeRange: !!timeRange, topicId },
    );
    logTiming(timing, 'db.message.messageGroups.groups.select:rows', { rowCount: groups.length });

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    // 2. Get all message IDs that belong to these groups (using messageGroupId relation)
    const groupMessageRecords = await runTimedStage(
      timing,
      'db.message.messageGroups.messages.select',
      () =>
        this.db
          .select({
            favorite: messages.favorite,
            id: messages.id,
            messageGroupId: messages.messageGroupId,
          })
          .from(messages)
          .where(and(this.ownership(), inArray(messages.messageGroupId, groupIds)))
          .orderBy(asc(messages.createdAt)),
      { groupCount: groupIds.length },
    );
    logTiming(timing, 'db.message.messageGroups.messages.select:rows', {
      rowCount: groupMessageRecords.length,
    });

    // 3. Query full message data using queryByIds (reuses all transformation logic)
    const allMessageIds = groupMessageRecords.map((m) => m.id as string);
    const fullMessages = await runTimedStage(
      timing,
      'db.message.messageGroups.queryByIds',
      () => this.queryByIds(allMessageIds, { postProcessUrl }),
      { messageCount: allMessageIds.length },
    );

    // Create a map for quick lookup
    const messageMap = new Map(fullMessages.map((m) => [m.id, m]));
    const favoriteMap = new Map(groupMessageRecords.map((m) => [m.id, m.favorite]));

    // 4. Build MessageGroup nodes
    return groups.map((group) => {
      // Get messages for this group
      const groupMsgIds = groupMessageRecords
        .filter((m) => m.messageGroupId === group.id)
        .map((m) => m.id as string);

      const groupMsgs = groupMsgIds
        .map((id) => messageMap.get(id))
        .filter(Boolean) as UIChatMessage[];

      if (group.type === MessageGroupType.Compression) {
        // compressedGroup: extract pinnedMessages (favorite=true)
        const pinnedMessages = groupMsgIds
          .filter((id) => favoriteMap.get(id) === true)
          .map((id) => {
            const m = messageMap.get(id);
            return m
              ? {
                  content: m.content,
                  createdAt: m.createdAt,
                  id: m.id,
                  model: m.model,
                  provider: m.provider,
                  role: m.role,
                }
              : null;
          })
          .filter(Boolean);

        // compressedMessages: parse messages through conversation-flow for proper grouping
        // This transforms raw messages into displayMessages format (e.g., assistantGroup)
        const { flatList } = parse(groupMsgs);
        const compressedMessages = flatList;

        // Get the last message ID for parent-child linking in conversation-flow
        const lastMessageId = groupMsgIds.at(-1);

        return {
          compressedMessages,
          content: group.content,
          createdAt: group.createdAt,
          id: group.id,
          lastMessageId,
          metadata: group.metadata,
          pinnedMessages,
          role: 'compressedGroup',
          topicId: group.topicId,
          updatedAt: group.updatedAt,
        } as unknown as UIChatMessage;
      } else {
        // compareGroup (parallel): include children with basic info
        const children = groupMsgs.map((m) => ({
          content: m.content,
          createdAt: m.createdAt,
          id: m.id,
          model: m.model,
          provider: m.provider,
          role: m.role,
        }));

        return {
          children,
          createdAt: group.createdAt,
          id: group.id,
          role: 'compareGroup',
          topicId: group.topicId,
          updatedAt: group.updatedAt,
        } as unknown as UIChatMessage;
      }
    });
  };

  /**
   * Build where condition for thread queries
   *
   * Returns a condition that matches both parent messages and thread messages.
   */
  private buildThreadQueryCondition = async (threadId: string): Promise<SQL | undefined> => {
    // Fetch the thread info to get sourceMessageId and type
    const thread = await this.db.query.threads.findFirst({
      where: and(
        eq(threads.id, threadId),
        buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
      ),
    });

    if (!thread?.sourceMessageId || !thread?.topicId) {
      // Fallback to simple thread query if no source message
      return eq(messages.threadId, threadId);
    }

    // Get parent messages based on thread type
    const parentMessages = await this.getThreadParentMessages({
      sourceMessageId: thread.sourceMessageId,
      threadType: thread.type as IThreadType,
      topicId: thread.topicId,
    });

    const parentMessageIds = parentMessages.map((m) => m.id);

    if (parentMessageIds.length === 0) {
      return eq(messages.threadId, threadId);
    }

    // Match either thread messages or parent messages
    return or(eq(messages.threadId, threadId), inArray(messages.id, parentMessageIds));
  };

  /**
   * Build agent condition with legacy sessionId support
   */
  private buildAgentCondition = async (agentId: string): Promise<SQL | undefined> => {
    // Get the associated sessionId for backward compatibility with legacy data
    const agentSession = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    return associatedSessionId
      ? or(eq(messages.agentId, agentId), eq(messages.sessionId, associatedSessionId))
      : eq(messages.agentId, agentId);
  };

  findById = async (id: string) => {
    return this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), this.ownership()),
    });
  };

  /**
   * Resolve the `role='verify'` delivery-checker card for an Agent Run (created
   * with `metadata.verifyOperationId = operationId`). Used by auto-repair to
   * persist the failure feedback onto the card it belongs to.
   */
  findVerifyMessageByOperationId = async (operationId: string) => {
    return this.db.query.messages.findFirst({
      where: and(
        eq(messages.userId, this.userId),
        eq(messages.role, 'verify'),
        sql`${messages.metadata}->>'verifyOperationId' = ${operationId}`,
      ),
      orderBy: [desc(messages.createdAt)],
    });
  };

  /**
   * Get parent messages for a thread
   *
   * @param params - Parameters for getting parent messages
   * @param params.sourceMessageId - The ID of the source message that started the thread
   * @param params.topicId - The topic ID the thread belongs to
   * @param params.threadType - The type of thread (Continuation, Standalone, or Isolation)
   * @returns Parent messages based on thread type:
   *   - Continuation: All messages from the topic up to and including the source message
   *   - Standalone: Only the source message itself
   *   - Isolation: No parent messages (completely isolated thread)
   */
  getThreadParentMessages = async (params: {
    sourceMessageId: string;
    threadType: IThreadType;
    topicId: string;
  }): Promise<DBMessageItem[]> => {
    const { sourceMessageId, topicId, threadType } = params;

    // For Isolation type, return empty array (no parent messages)
    if (threadType === ThreadType.Isolation) {
      return [];
    }

    // For Standalone type, only return the source message
    if (threadType === ThreadType.Standalone) {
      const sourceMessage = await this.db.query.messages.findFirst({
        where: and(eq(messages.id, sourceMessageId), this.ownership()),
      });

      return sourceMessage ? [sourceMessage as DBMessageItem] : [];
    }

    // For Continuation type, get the source message first to know its createdAt
    const sourceMessage = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, sourceMessageId), this.ownership()),
    });

    if (!sourceMessage) return [];

    // Get all main conversation messages up to and including the source message
    // Use `or` with explicit id match to handle timestamp precision issues
    // (JavaScript Date has millisecond precision, but PostgreSQL timestamptz has microsecond precision)
    const result = await this.db
      .select()
      .from(messages)
      .where(
        and(
          this.ownership(),
          eq(messages.topicId, topicId),
          isNull(messages.threadId), // Only main conversation messages (not in any thread)
          or(
            lte(messages.createdAt, sourceMessage.createdAt),
            eq(messages.id, sourceMessageId), // Ensure source message is always included
          ),
        ),
      )
      .orderBy(asc(messages.createdAt));

    return result as DBMessageItem[];
  };

  findMessageQueriesById = async (messageId: string) => {
    const result = await this.db
      .select({
        embeddings: embeddings.embeddings,
        id: messageQueries.id,
        query: messageQueries.rewriteQuery,
        rewriteQuery: messageQueries.rewriteQuery,
        userQuery: messageQueries.userQuery,
      })
      .from(messageQueries)
      .where(and(eq(messageQueries.messageId, messageId)))
      .leftJoin(embeddings, eq(embeddings.id, messageQueries.embeddingsId));

    if (result.length === 0) return undefined;

    return result[0];
  };

  queryAll = async (params?: { current?: number; pageSize?: number }) => {
    const { current = 0, pageSize = 100 } = params ?? {};
    const offset = current * pageSize;

    const result = await this.db
      .select()
      .from(messages)
      .where(and(this.ownership()))
      .orderBy(desc(messages.createdAt))
      .limit(pageSize)
      .offset(offset);

    return result as DBMessageItem[];
  };

  queryBySessionId = async (sessionId?: string | null) => {
    const result = await this.db.query.messages.findMany({
      orderBy: [asc(messages.createdAt)],
      where: and(this.ownership(), this.matchSession(sessionId)),
    });

    return result as DBMessageItem[];
  };

  queryByKeyword = async (keyword: string) => {
    if (!keyword.trim()) return [];

    const bm25Query = sanitizeBm25Query(keyword);
    const result = await this.db
      .select()
      .from(messages)
      .where(and(this.ownership(), sql`${messages.content} @@@ ${bm25Query}`))
      .orderBy(desc(messages.createdAt));

    return result as DBMessageItem[];
  };

  count = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({
        count: count(messages.id),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          params?.range
            ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return result[0].count;
  };

  hasTopicMessages = async (topicId: string): Promise<boolean> => {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.topicId, topicId), this.ownership()))
      .limit(1);

    return rows.length > 0;
  };

  findFirstAssistantInTopic = async (topicId: string): Promise<DBMessageItem | undefined> => {
    const rows = (await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.topicId, topicId), eq(messages.role, 'assistant'), this.ownership()))
      .orderBy(asc(messages.createdAt))
      .limit(1)) as DBMessageItem[];

    return rows[0];
  };

  countWords = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({
        count: sql<string>`sum(length(${messages.content}))`.as('total_length'),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          params?.range
            ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return Number(result[0].count);
  };

  rankModels = async (limit: number = 10): Promise<ModelRankItem[]> => {
    return this.db
      .select({
        count: count(messages.id).as('count'),
        id: messages.model,
      })
      .from(messages)
      .where(and(this.ownership(), isNotNull(messages.model)))
      .having(({ count }) => gt(count, 0))
      .groupBy(messages.model)
      .orderBy(desc(sql`count`), asc(messages.model))
      .limit(limit);
  };

  getHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    const startDate = today().subtract(1, 'year').startOf('day');
    const endDate = today().endOf('day');

    const result = await this.db
      .select({
        count: count(messages.id),
        date: sql`DATE(${messages.createdAt})`.as('heatmaps_date'),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          genRangeWhere(
            [startDate.format('YYYY-MM-DD'), endDate.add(1, 'day').format('YYYY-MM-DD')],
            messages.createdAt,
            (date) => date.toDate(),
          ),
        ]),
      )
      .groupBy(sql`heatmaps_date`)
      .orderBy(desc(sql`heatmaps_date`));

    const heatmapData: HeatmapsProps['data'] = [];
    let currentDate = startDate.clone();

    const dateCountMap = new Map<string, number>();
    for (const item of result) {
      if (item?.date) {
        const dateStr = dayjs(item.date as string).format('YYYY-MM-DD');
        dateCountMap.set(dateStr, item.count);
      }
    }

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const formattedDate = currentDate.format('YYYY-MM-DD');
      const count = dateCountMap.get(formattedDate) || 0;

      const levelCount = count > 0 ? Math.ceil(count / 5) : 0;
      const level = levelCount > 4 ? 4 : levelCount;

      heatmapData.push({
        count,
        date: formattedDate,
        level,
      });

      currentDate = currentDate.add(1, 'day');
    }

    return heatmapData;
  };

  /**
   * Daily token-usage heatmap for the last year.
   *
   * Sums `usage.totalTokens` of assistant messages bucketed by the day each
   * message was created — so tokens land on the day they were actually consumed
   * (a long-running topic spreads across days instead of piling onto its
   * creation date). Reads prefer the dedicated `usage` column and fall back to
   * legacy `metadata.usage`, aggregating directly in SQL rather than pulling
   * rows into JS. `level` is scaled relative to the busiest day so the heatmap
   * stays readable regardless of absolute token volume.
   */
  getTokenHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    const startDate = today().subtract(1, 'year').startOf('day');
    const endDate = today().endOf('day');

    const result = await this.db
      .select({
        date: sql`DATE(${messages.createdAt})`.as('heatmaps_date'),
        tokens:
          sql<number>`COALESCE(SUM((COALESCE(${messages.usage}, ${messages.metadata}->'usage')->>'totalTokens')::numeric), 0)`.mapWith(
            Number,
          ),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          eq(messages.role, 'assistant'),
          genRangeWhere(
            [startDate.format('YYYY-MM-DD'), endDate.add(1, 'day').format('YYYY-MM-DD')],
            messages.createdAt,
            (date) => date.toDate(),
          ),
        ]),
      )
      .groupBy(sql`heatmaps_date`)
      .orderBy(desc(sql`heatmaps_date`));

    const dateTokenMap = new Map<string, number>();
    let maxTokens = 0;
    for (const item of result) {
      if (item?.date) {
        const dateStr = dayjs(item.date as string).format('YYYY-MM-DD');
        const tokens = item.tokens || 0;
        dateTokenMap.set(dateStr, tokens);
        if (tokens > maxTokens) maxTokens = tokens;
      }
    }

    const heatmapData: HeatmapsProps['data'] = [];
    let currentDate = startDate.clone();

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const formattedDate = currentDate.format('YYYY-MM-DD');
      const tokens = dateTokenMap.get(formattedDate) || 0;

      // Scale to 1-4 relative to the busiest day; 0 tokens stays at level 0.
      const level =
        tokens > 0 && maxTokens > 0
          ? Math.min(4, Math.max(1, Math.ceil((tokens / maxTokens) * 4)))
          : 0;

      heatmapData.push({
        count: tokens,
        date: formattedDate,
        level,
      });

      currentDate = currentDate.add(1, 'day');
    }

    return heatmapData;
  };

  hasMoreThanN = async (n: number): Promise<boolean> => {
    const result = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(this.ownership()))
      .limit(n + 1);

    return result.length > n;
  };

  /**
   * Count messages up to a limit, useful for avoiding full table scans
   */
  countUpTo = async (n: number): Promise<number> => {
    const result = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(this.ownership()))
      .limit(n);

    return result.length;
  };

  // **************** Create *************** //

  private splitCreateMessageParams = ({
    fileChunks,
    files,
    model: fromModel,
    plugin,
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

    return buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        ...normalizedMessage,
        // Sanitize content to strip null bytes that PostgreSQL rejects
        content: sanitizeNullBytes(normalizedMessage.content),
        // TODO: remove this when the client is updated
        createdAt: createdAt ? new Date(createdAt) : undefined,
        id,
        model: fromModel,
        provider: fromProvider,
        updatedAt: updatedAt ? new Date(updatedAt) : undefined,
        // Promote token usage into the dedicated `usage` column, preferring a
        // top-level `usage` over the legacy `metadata.usage`.
        usage:
          normalizedMessage.usage ??
          (normalizedMessage.metadata as { usage?: ModelUsage } | undefined)?.usage,
      },
    );
  };

  private insertMessageRelationsInTransaction = async (
    trx: Transaction,
    {
      fileChunks,
      files,
      plugin,
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
          apiName: plugin?.apiName,
          arguments: sanitizeNullBytes(plugin?.arguments),
          id,
          identifier: plugin?.identifier,
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
    { timing }: CreateUserAndAssistantMessagesOptions = {},
  ): Promise<{ assistantMessage: DBMessageItem; userMessage: DBMessageItem }> => {
    const userMessageId = this.genId();
    const assistantMessageId = this.genId();
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
  // **************** Update *************** //

  update = async (
    id: string,
    { imageList, metadata, usage, ...message }: Partial<UpdateMessageParams>,
    timing?: ModelTimingContext,
  ): Promise<{ success: boolean }> => {
    // Promote token usage into the dedicated `usage` column. Prefer a top-level
    // `usage` payload, falling back to `metadata.usage` so existing writers
    // (Gateway / hetero-agent executors) keep populating the column without
    // changes. `metadata.usage` is still written for backward-compatible reads.
    const usageToWrite = usage ?? (metadata as { usage?: ModelUsage } | undefined)?.usage;
    // Keep `metadata.usage` dual-written even when usage arrives as a top-level
    // param (with no metadata payload) — legacy readers / rollback paths still
    // consume it during the transition. Folding the resolved usage into the
    // patch also keeps it consistent with the column when both are sent.
    const metadataPatch =
      metadata || usageToWrite
        ? { ...metadata, ...(usageToWrite && { usage: usageToWrite }) }
        : undefined;
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

            // 2. Handle metadata merge if there's a metadata payload or a
            // top-level usage to fold back into `metadata.usage`.
            let mergedMetadata: Record<string, any> | undefined;
            if (metadataPatch) {
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
            }

            const [updated] = await runTimedStage(
              timing,
              'db.message.update.messages.update',
              () =>
                trx
                  .update(messages)
                  .set({
                    ...message,
                    ...(mergedMetadata && { metadata: mergedMetadata }),
                    ...(usageToWrite && { usage: usageToWrite }),
                  })
                  .where(and(eq(messages.id, id), this.ownership()))
                  .returning({ topicId: messages.topicId }),
              { hasMetadata: !!metadataPatch, valueKeys: Object.keys(message) },
            );

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
          hasMetadata: !!metadataPatch,
          valueKeys: Object.keys(message),
        },
      );

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

    const mergedMetadata = merge(item.metadata || {}, metadata);
    // Keep the dedicated `usage` column in sync when the merged metadata carries
    // token usage, preferring it over the existing column value.
    const usageToWrite = (metadata as { usage?: ModelUsage } | undefined)?.usage;

    return this.db
      .update(messages)
      .set({ metadata: mergedMetadata, ...(usageToWrite && { usage: usageToWrite }) })
      .where(and(eq(messages.id, id), this.ownership()));
  };

  updatePluginState = async (id: string, state: Record<string, any>): Promise<void> => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: and(eq(messagePlugins.id, id), this.pluginsOwnership()),
    });
    if (!item) throw new Error('Plugin not found');

    await this.db
      .update(messagePlugins)
      .set({ state: merge(item.state || {}, state) })
      .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()));
  };

  updateMessagePlugin = async (id: string, value: Partial<MessagePluginItem>) => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: and(eq(messagePlugins.id, id), this.pluginsOwnership()),
    });
    if (!item) throw new Error('Plugin not found');

    return this.db
      .update(messagePlugins)
      .set(value)
      .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()));
  };

  /**
   * Fetch the `message_plugins` row associated with a tool message. Tool-call
   * metadata (identifier / apiName / arguments / type / toolCallId /
   * intervention) lives on this row, not on the `messages` row returned by
   * {@link findById}.
   *
   * Returns `undefined` when the message has no plugin row. Normalizes the
   * DB row (nullable columns) into the optional-field shape of
   * {@link MessagePluginItem} so callers don't need to juggle `null` vs
   * `undefined`.
   */
  findMessagePlugin = async (messageId: string): Promise<MessagePluginItem | undefined> => {
    const row = await this.db.query.messagePlugins.findFirst({
      where: and(eq(messagePlugins.id, messageId), this.pluginsOwnership()),
    });
    if (!row) return undefined;
    return {
      apiName: row.apiName ?? undefined,
      arguments: row.arguments ?? undefined,
      clientId: row.clientId ?? undefined,
      error: row.error ?? undefined,
      id: row.id,
      identifier: row.identifier ?? undefined,
      intervention: row.intervention ?? undefined,
      state: row.state ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type ?? 'default',
      userId: row.userId,
    };
  };

  /**
   * List tool/plugin rows for a topic in stable first-seen order.
   *
   * This is used by onboarding analytics to reconstruct successful assistant
   * creation results before the topic is moved into inbox.
   */
  listMessagePluginsByTopic = async (topicId: string): Promise<MessagePluginItem[]> => {
    const rows = await this.db
      .select({
        apiName: messagePlugins.apiName,
        arguments: messagePlugins.arguments,
        clientId: messagePlugins.clientId,
        error: messagePlugins.error,
        id: messagePlugins.id,
        identifier: messagePlugins.identifier,
        intervention: messagePlugins.intervention,
        state: messagePlugins.state,
        toolCallId: messagePlugins.toolCallId,
        type: messagePlugins.type,
        userId: messagePlugins.userId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messagePlugins.id, messages.id))
      .where(and(eq(messages.topicId, topicId), this.ownership(), this.pluginsOwnership()))
      .orderBy(asc(messages.createdAt), asc(messages.id));

    return rows.map((row) => ({
      apiName: row.apiName ?? undefined,
      arguments: row.arguments ?? undefined,
      clientId: row.clientId ?? undefined,
      error: row.error ?? undefined,
      id: row.id,
      identifier: row.identifier ?? undefined,
      intervention: row.intervention ?? undefined,
      state: row.state ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type ?? 'default',
      userId: row.userId,
    }));
  };

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   */
  updateToolMessage = async (
    id: string,
    params: {
      content?: string;
      metadata?: Record<string, any>;
      pluginError?: any;
      pluginState?: Record<string, any>;
    },
  ): Promise<{ success: boolean }> => {
    const { content, metadata, pluginState, pluginError } = params;

    try {
      await this.db.transaction(async (trx) => {
        // Update messages table (content, metadata)
        if (content !== undefined || metadata !== undefined) {
          const messageUpdateData: Record<string, any> = {};

          if (content !== undefined) {
            messageUpdateData.content = content;
          }

          if (metadata !== undefined) {
            // Need to merge with existing metadata
            const existingMessage = await trx.query.messages.findFirst({
              where: and(eq(messages.id, id), this.ownership()),
            });
            messageUpdateData.metadata = merge(existingMessage?.metadata || {}, metadata);
          }

          if (Object.keys(messageUpdateData).length > 0) {
            await trx
              .update(messages)
              .set(messageUpdateData)
              .where(and(eq(messages.id, id), this.ownership()));
          }
        }

        // Update messagePlugins table (pluginState, pluginError)
        if (pluginState !== undefined || pluginError !== undefined) {
          const pluginItem = await trx.query.messagePlugins.findFirst({
            where: and(eq(messagePlugins.id, id), this.pluginsOwnership()),
          });

          if (pluginItem) {
            const pluginUpdateData: Record<string, any> = {};

            if (pluginState !== undefined) {
              pluginUpdateData.state = merge(pluginItem.state || {}, pluginState);
            }

            if (pluginError !== undefined) {
              pluginUpdateData.error = pluginError;
            }

            if (Object.keys(pluginUpdateData).length > 0) {
              await trx
                .update(messagePlugins)
                .set(pluginUpdateData)
                .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()));
            }
          }
        }
      });

      return { success: true };
    } catch (error) {
      console.error('Update tool message error:', error);
      return { success: false };
    }
  };

  /**
   * Update tool arguments by toolCallId - updates both tool message plugin.arguments
   * and parent assistant message tools[].arguments in a single transaction
   *
   * This method uses toolCallId (the stable identifier from AI response) instead of
   * tool message ID, which allows updating arguments even when the tool message
   * hasn't been persisted yet (e.g., during intervention pending state).
   *
   * @param toolCallId - The tool call ID (stable identifier from AI response)
   * @param args - The new arguments string (already stringified JSON)
   */
  updateToolArguments = async (toolCallId: string, args: string): Promise<{ success: boolean }> => {
    try {
      await this.db.transaction(async (trx) => {
        // 1. Find tool plugin and tool message with parentId in one query
        const [toolResult] = await trx
          .select({
            parentId: messages.parentId,
            toolPluginId: messagePlugins.id,
          })
          .from(messagePlugins)
          .innerJoin(messages, eq(messages.id, messagePlugins.id))
          .where(and(eq(messagePlugins.toolCallId, toolCallId), this.ownership()))
          .limit(1);

        if (!toolResult?.parentId) {
          throw new Error(`No tool message found with toolCallId: ${toolCallId}`);
        }

        // 2. Get parent assistant message's tools
        const [parentMessage] = await trx
          .select({ id: messages.id, tools: messages.tools })
          .from(messages)
          .where(and(eq(messages.id, toolResult.parentId), this.ownership()))
          .limit(1);

        if (!parentMessage?.tools) {
          throw new Error(`No parent assistant message found for toolCallId: ${toolCallId}`);
        }

        const parentTools = parentMessage.tools as ChatToolPayload[];

        // 3. Update the parent assistant message's tools[].arguments
        const updatedTools = parentTools.map((tool) => {
          if (tool.id === toolCallId) {
            return { ...tool, arguments: args };
          }
          return tool;
        });

        // Execute both updates in parallel
        await Promise.all([
          // Update tool plugin arguments
          trx
            .update(messagePlugins)
            .set({ arguments: args })
            .where(and(eq(messagePlugins.id, toolResult.toolPluginId), this.pluginsOwnership())),
          // Update parent assistant message's tools
          trx
            .update(messages)
            .set({ tools: updatedTools })
            .where(and(eq(messages.id, parentMessage.id), this.ownership())),
        ]);
      });

      return { success: true };
    } catch (error) {
      console.error('Update tool arguments error:', error);
      return { success: false };
    }
  };

  /**
   * Id of the latest main-thread (`threadId IS NULL`) "spine" message in a
   * topic: the most recent message that is NOT a tool and NOT a signal-tagged
   * reactive turn (Monitor stdout callbacks etc.). This is the chain anchor for
   * the heterogeneous-agent write side: the next normal
   * turn parents off it, producing a `user → asst → asst …` spine with tools as
   * inline children.
   *
   * Read straight from the DB and ordered by `createdAt`, it is independent of
   * the in-memory current-assistant pointer — which can regress to the run's
   * seed placeholder on a cold / non-sticky serverless replica. Anchoring here
   * instead keeps consecutive cold-replica steps chained linearly rather than
   * forking onto a stale node (the remote "断链" bug). No `createdAt` floor is
   * needed: a topic runs at most one operation at a time, so the latest spine
   * message IS this run's continuation point.
   *
   * Excludes `role:'tool'` (inline children) and signal-tagged assistants
   * (`metadata->'signal'`), which are tool-child callbacks — anchoring a normal
   * turn onto a callback would orphan it under the read side's tool-only signal
   * collection.
   */
  getLastMainThreadSpineMessageId = async (topicId: string): Promise<string | undefined> => {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          not(eq(messages.role, 'tool')),
          isNull(messages.threadId),
          sql`${messages.metadata} -> 'signal' IS NULL`,
          this.ownership(),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return row?.id;
  };

  updateTranslate = async (id: string, translate: Partial<ChatTranslate>) => {
    const result = await this.db.query.messageTranslates.findFirst({
      where: and(eq(messageTranslates.id, id), this.translatesOwnership()),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTranslates).values({
        ...translate,
        id,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTranslates)
      .set(translate)
      .where(and(eq(messageTranslates.id, id), this.translatesOwnership()));
  };

  updateTTS = async (id: string, tts: Partial<ChatTTS>) => {
    const result = await this.db.query.messageTTS.findFirst({
      where: and(eq(messageTTS.id, id), this.ttsOwnership()),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTTS).values({
        contentMd5: tts.contentMd5,
        fileId: tts.file,
        id,
        userId: this.userId,
        voice: tts.voice,
        workspaceId: this.workspaceId ?? null,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTTS)
      .set({ contentMd5: tts.contentMd5, fileId: tts.file, voice: tts.voice })
      .where(and(eq(messageTTS.id, id), this.ttsOwnership()));
  };

  async updateMessageRAG(id: string, { ragQueryId, fileChunks }: UpdateMessageRAGParams) {
    return this.db.insert(messageQueryChunks).values(
      fileChunks.map((chunk) => ({
        chunkId: chunk.id,
        messageId: id,
        queryId: ragQueryId,
        similarity: chunk.similarity?.toString(),
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })),
    );
  }

  // **************** Delete *************** //

  deleteMessage = async (id: string) => {
    return this.db.transaction(async (tx) => {
      // 1. Query the complete information of the message to be deleted
      const message = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, id), this.ownership()))
        .limit(1);

      // If the message to be deleted is not found, return directly
      if (message.length === 0) return;

      // 2. Update child messages' parentId to the current message's parentId
      // This preserves the tree structure when deleting a node
      await tx
        .update(messages)
        .set({ parentId: message[0].parentId })
        .where(and(eq(messages.parentId, id), this.ownership()));

      // 3. Check if the message contains tools
      const toolCallIds = (message[0].tools as ChatToolPayload[])
        ?.map((tool) => tool.id)
        .filter(Boolean);

      let relatedMessageIds: string[] = [];

      if (toolCallIds?.length > 0) {
        // 4. If the message contains tools, query all associated message ids
        const res = await tx
          .select({ id: messagePlugins.id })
          .from(messagePlugins)
          .where(inArray(messagePlugins.toolCallId, toolCallIds));

        relatedMessageIds = res.map((row) => row.id);
      }

      // 5. Merge the list of message ids to be deleted
      const messageIdsToDelete = [id, ...relatedMessageIds];

      // 6. Delete all related messages
      await tx
        .delete(messages)
        .where(and(this.ownership(), inArray(messages.id, messageIdsToDelete)));

      // 7. Keep the topic's usage rollup in sync (pure derived — a removed
      // assistant message must drop out of the topic totals).
      if (message[0].topicId) {
        await recomputeTopicUsage(tx, this.userId, message[0].topicId, this.workspaceId);
      }
    });
  };

  deleteMessages = async (ids: string[]) => {
    if (ids.length === 0) return;

    return this.db.transaction(async (tx) => {
      // 1. Query all messages to be deleted with their parentId
      const toDelete = await tx
        .select({ id: messages.id, parentId: messages.parentId, topicId: messages.topicId })
        .from(messages)
        .where(and(this.ownership(), inArray(messages.id, ids)));

      if (toDelete.length === 0) return;

      // 2. Build id -> parentId map and deleteSet
      const parentMap = new Map<string, string | null>();
      const deleteSet = new Set<string>();
      for (const msg of toDelete) {
        parentMap.set(msg.id, msg.parentId);
        deleteSet.add(msg.id);
      }

      // 3. Find the final ancestor for each deleted message (first ancestor not in deleteSet)
      const finalAncestorMap = new Map<string, string | null>();

      const findFinalAncestor = (id: string): string | null => {
        if (finalAncestorMap.has(id)) return finalAncestorMap.get(id)!;

        const parentId = parentMap.get(id);
        if (parentId === null || parentId === undefined) {
          finalAncestorMap.set(id, null);
          return null;
        }

        if (!deleteSet.has(parentId)) {
          // Parent is not being deleted, it's the final ancestor
          finalAncestorMap.set(id, parentId);
          return parentId;
        }

        // Parent is also being deleted, recursively find its ancestor
        const ancestor = findFinalAncestor(parentId);
        finalAncestorMap.set(id, ancestor);
        return ancestor;
      };

      for (const id of deleteSet) {
        findFinalAncestor(id);
      }

      // 4. Query child messages whose parentId points to messages being deleted
      const children = await tx
        .select({ id: messages.id, parentId: messages.parentId })
        .from(messages)
        .where(
          and(this.ownership(), inArray(messages.parentId, ids), not(inArray(messages.id, ids))),
        );

      // 5. Update each child's parentId to the final ancestor
      for (const child of children) {
        const newParentId = finalAncestorMap.get(child.parentId!) ?? null;
        await tx
          .update(messages)
          .set({ parentId: newParentId })
          .where(and(eq(messages.id, child.id), this.ownership()));
      }

      // 6. Delete the messages
      await tx.delete(messages).where(and(this.ownership(), inArray(messages.id, ids)));

      // 7. Recompute the usage rollup for every affected topic (pure derived).
      const affectedTopicIds = [
        ...new Set(toDelete.map((m) => m.topicId).filter(Boolean) as string[]),
      ];
      for (const topicId of affectedTopicIds) {
        await recomputeTopicUsage(tx, this.userId, topicId, this.workspaceId);
      }
    });
  };

  /**
   * Add files to a message by inserting records into messagesFiles table
   * This associates existing files with a message for display in fileList/imageList/videoList
   */
  addFiles = async (messageId: string, fileIds: string[]): Promise<{ success: boolean }> => {
    if (fileIds.length === 0) return { success: true };

    try {
      await this.db.insert(messagesFiles).values(
        fileIds.map((fileId) => ({
          fileId,
          messageId,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      );
      return { success: true };
    } catch (error) {
      console.error('Add files to message error:', error);
      return { success: false };
    }
  };

  deleteMessageTranslate = async (id: string) =>
    this.db
      .delete(messageTranslates)
      .where(and(eq(messageTranslates.id, id), this.translatesOwnership()));

  deleteMessageTTS = async (id: string) =>
    this.db.delete(messageTTS).where(and(eq(messageTTS.id, id), this.ttsOwnership()));

  deleteMessageQuery = async (id: string) =>
    this.db
      .delete(messageQueries)
      .where(
        and(
          eq(messageQueries.id, id),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            messageQueries,
          ),
        ),
      );

  deleteMessagesBySession = async (
    sessionId?: string | null,
    topicId?: string | null,
    groupId?: string | null,
  ) =>
    this.db
      .delete(messages)
      .where(
        and(
          this.ownership(),
          this.matchSession(sessionId),
          this.matchTopic(topicId),
          this.matchGroup(groupId),
        ),
      );

  deleteAllMessages = async () => {
    return this.db.delete(messages).where(and(this.ownership()));
  };

  /**
   * Deletes multiple messages based on the agentId.
   * This will delete messages that have either:
   * 1. Direct agentId match (new data)
   * 2. SessionId match via agentsToSessions lookup (legacy data)
   */
  batchDeleteByAgentId = async (agentId: string) => {
    // Get the associated sessionId for backward compatibility with legacy data
    const agentSession = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    const agentCondition = associatedSessionId
      ? or(eq(messages.agentId, agentId), eq(messages.sessionId, associatedSessionId))
      : eq(messages.agentId, agentId);

    return this.db.delete(messages).where(and(this.ownership(), agentCondition));
  };

  // **************** Helper *************** //

  // 18-char hash (was 14): widen the message id space — the coordinator-driven
  // hetero subagent flow allocates many ids per run, and a few extra chars keep
  // collision odds negligible at that volume.
  private genId = () => idGenerator('messages', 18);

  private matchSession = (sessionId?: string | null) => {
    if (sessionId === INBOX_SESSION_ID) return isNull(messages.sessionId);

    return sessionId ? eq(messages.sessionId, sessionId) : isNull(messages.sessionId);
  };

  private matchTopic = (topicId?: string | null) =>
    topicId ? eq(messages.topicId, topicId) : isNull(messages.topicId);

  private matchGroup = (groupId?: string | null) =>
    groupId ? eq(messages.groupId, groupId) : isNull(messages.groupId);

  private matchThread = (threadId?: string | null) => {
    if (!!threadId) return eq(messages.threadId, threadId);
    return isNull(messages.threadId);
  };

  /**
   * Check which user IDs from the given list have at least one message.
   */
  static checkUsersHaveMessages = async (
    db: LobeChatDatabase,
    userIds: string[],
  ): Promise<Set<string>> => {
    if (userIds.length === 0) return new Set();
    const result = await db
      .select({ userId: messages.userId })
      .from(messages)
      .where(inArray(messages.userId, userIds))
      .groupBy(messages.userId);
    return new Set(result.map((r) => r.userId));
  };
}
