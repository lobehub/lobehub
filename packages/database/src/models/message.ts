import { INBOX_SESSION_ID } from '@lobechat/const';
import { parse } from '@lobechat/conversation-flow';
import type {
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
  NewMessageQueryParams,
  QueryMessageParams,
  TaskDetail,
  ThreadStatus,
  UIChatMessage,
  UpdateMessageParams,
  UpdateMessageRAGParams,
} from '@lobechat/types';
import { MessageGroupType, ThreadType } from '@lobechat/types';
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
  like,
  lte,
  not,
  or,
  sql,
} from 'drizzle-orm';

import { merge } from '@/utils/merge';
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
import type { LobeChatDatabase } from '../type';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';

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
  postProcessUrl?: (path: string | null, file: { fileType: string }) => Promise<string>;
  /**
   * Topic ID for MessageGroup aggregation queries
   */
  topicId?: string;
  /**
   * Custom where condition for message filtering
   */
  where?: SQL;
}

export class MessageModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

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
      postProcessUrl?: (path: string | null, file: { fileType: string }) => Promise<string>;
    } = {},
  ) => {
    // Build agent condition (handles legacy sessionId lookup)
    let agentCondition: SQL | undefined;
    if (agentId) {
      agentCondition = await this.buildAgentCondition(agentId);
    } else if (sessionId) {
      agentCondition = this.matchSession(sessionId);
    }

    // For thread queries, we need to fetch complete thread data (parent + thread messages)
    if (threadId) {
      const threadCondition = await this.buildThreadQueryCondition(threadId);
      return this.queryWithWhere({
        current,
        pageSize,
        postProcessUrl: options.postProcessUrl,
        // Thread queries optionally add agent/session scope if provided
        where: agentCondition ? and(agentCondition, threadCondition) : threadCondition,
      });
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

      return this.queryWithWhere({
        current,
        pageSize,
        postProcessUrl: options.postProcessUrl,
        topicId: topicId ?? undefined,
        where: whereCondition,
      });
    }

    // Standard query with session/topic/group filters
    const whereCondition = and(
      agentCondition ?? this.matchSession(sessionId),
      this.matchTopic(topicId),
      this.matchGroup(groupId),
      this.matchThread(threadId),
    );

    return this.queryWithWhere({
      current,
      pageSize,
      postProcessUrl: options.postProcessUrl,
      topicId: topicId ?? undefined,
      where: whereCondition,
    });
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
    const { where, current = 0, pageSize = 1000, postProcessUrl, topicId } = options;
    const offset = current * pageSize;

    // 1. get basic messages with joins, excluding messages that belong to MessageGroups
    const result = await this.db
      .select({
        /* eslint-disable sort-keys-fix/sort-keys-fix*/
        id: messages.id,
        role: messages.role,
        content: messages.content,
        reasoning: messages.reasoning,
        search: messages.search,
        metadata: messages.metadata,
        error: messages.error,

        model: messages.model,
        provider: messages.provider,

        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,

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
          eq(messages.userId, this.userId),
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
      .offset(offset);

    const messageIds = result.map((message) => message.id as string);

    // 2. Query MessageGroups for this topic (if topicId is available)
    // For pagination support:
    // - First page (current === 0): fetch all MessageGroup nodes (no time filter)
    // - Subsequent pages: only fetch groups within the current page's time range
    let messageGroupNodes: UIChatMessage[] = [];
    if (topicId && result.length > 0) {
      if (current === 0) {
        // First page: fetch all groups to include compressed history
        messageGroupNodes = await this.queryMessageGroupNodes(topicId, undefined, postProcessUrl);
      } else {
        // Subsequent pages: filter by time range to avoid duplicates
        const firstMessageTime = result[0].createdAt;
        const lastMessageTime = result.at(-1)!.createdAt;
        messageGroupNodes = await this.queryMessageGroupNodes(
          topicId,
          {
            endTime: lastMessageTime,
            startTime: firstMessageTime,
          },
          postProcessUrl,
        );
      }
    } else if (topicId && current === 0) {
      // First page with no messages: still fetch all groups
      messageGroupNodes = await this.queryMessageGroupNodes(topicId, undefined, postProcessUrl);
    }

    // If no messages and no group nodes, return empty
    if (messageIds.length === 0 && messageGroupNodes.length === 0) return [];

    // 3. get relative files (only if we have messages)
    let relatedFileList: {
      fileType: string | null;
      id: string;
      messageId: string;
      name: string | null;
      size: number | null;
      url: string;
    }[] = [];

    if (messageIds.length > 0) {
      const rawRelatedFileList = await this.db
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
        .where(inArray(messagesFiles.messageId, messageIds));

      relatedFileList = await Promise.all(
        rawRelatedFileList.map(async (file) => ({
          ...file,
          url: postProcessUrl ? await postProcessUrl(file.url, file as any) : (file.url as string),
        })),
      );
    }

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
    const fileList = relatedFileList.filter(
      (i) => !(i.fileType || '').startsWith('image') && !(i.fileType || '').startsWith('video'),
    );

    // 4. get relative file chunks
    let chunksList: {
      fileId: string;
      fileType: string | null;
      fileUrl: string | null;
      filename: string | null;
      id: string | null;
      messageId: string | null;
      similarity: string | null;
      text: string | null;
    }[] = [];

    if (messageIds.length > 0) {
      chunksList = await this.db
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
        .where(inArray(messageQueryChunks.messageId, messageIds));
    }

    // 5. get relative message query
    let messageQueriesList: {
      id: string;
      messageId: string;
      rewriteQuery: string | null;
      userQuery: string | null;
    }[] = [];

    if (messageIds.length > 0) {
      messageQueriesList = await this.db
        .select({
          id: messageQueries.id,
          messageId: messageQueries.messageId,
          rewriteQuery: messageQueries.rewriteQuery,
          userQuery: messageQueries.userQuery,
        })
        .from(messageQueries)
        .where(inArray(messageQueries.messageId, messageIds));
    }

    // 5. get thread info for task messages
    const taskMessageIds = result.filter((m) => m.role === 'task').map((m) => m.id as string);

    let threadMap = new Map<string, TaskDetail>();

    if (taskMessageIds.length > 0) {
      const threadData = await this.db
        .select({
          metadata: threads.metadata,
          sourceMessageId: threads.sourceMessageId,
          status: threads.status,
          threadId: threads.id,
          title: threads.title,
        })
        .from(threads)
        .where(
          and(eq(threads.userId, this.userId), inArray(threads.sourceMessageId, taskMessageIds)),
        );

      threadMap = new Map(
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
    }

    // 6. Transform regular messages
    const transformedMessages = result.map(
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
            model: model,
            provider: provider,
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
          videoList: videoList
            .filter((relation) => relation.messageId === item.id)

            .map<ChatVideoItem>(({ id, url, name }) => ({ alt: name!, id, url })),
        } as unknown as UIChatMessage;
      },
    );

    // 7. Merge regular messages with MessageGroup nodes and sort by createdAt
    const allItems = [...transformedMessages, ...messageGroupNodes];
    allItems.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return aTime - bTime;
    });

    return allItems;
  };

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
      postProcessUrl?: (path: string | null, file: { fileType: string }) => Promise<string>;
    } = {},
  ): Promise<UIChatMessage[]> => {
    if (messageIds.length === 0) return [];

    const { postProcessUrl } = options;

    // 1. Query messages with joins
    const result = await this.db
      .select({
        /* eslint-disable sort-keys-fix/sort-keys-fix*/
        id: messages.id,
        role: messages.role,
        content: messages.content,
        reasoning: messages.reasoning,
        search: messages.search,
        metadata: messages.metadata,
        error: messages.error,

        model: messages.model,
        provider: messages.provider,

        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,

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
      .where(and(eq(messages.userId, this.userId), inArray(messages.id, messageIds)))
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
                eq(threads.userId, this.userId),
                inArray(threads.sourceMessageId, taskMessageIds),
              ),
            )
        : Promise.resolve([]),
    ]);

    // 3. Process file results
    const relatedFileList = await Promise.all(
      rawRelatedFileList.map(async (file) => ({
        ...file,
        url: postProcessUrl ? await postProcessUrl(file.url, file as any) : (file.url as string),
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
    const fileList = relatedFileList.filter(
      (i) => !(i.fileType || '').startsWith('image') && !(i.fileType || '').startsWith('video'),
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
            model: model,
            provider: provider,
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
          videoList: videoList
            .filter((relation) => relation.messageId === item.id)
            .map<ChatVideoItem>(({ id, url, name }) => ({ alt: name!, id, url })),
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
    postProcessUrl?: (path: string | null, file: { fileType: string }) => Promise<string>,
  ): Promise<UIChatMessage[]> => {
    // 1. Query MessageGroups for this topic, optionally filtered by time range
    const whereConditions = [
      eq(messageGroups.userId, this.userId),
      eq(messageGroups.topicId, topicId),
    ];

    // Add time range filter if provided (for pagination)
    if (timeRange) {
      whereConditions.push(
        gte(messageGroups.createdAt, timeRange.startTime),
        lte(messageGroups.createdAt, timeRange.endTime),
      );
    }

    const groups = await this.db
      .select()
      .from(messageGroups)
      .where(and(...whereConditions))
      .orderBy(asc(messageGroups.createdAt));

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    // 2. Get all message IDs that belong to these groups (using messageGroupId relation)
    const groupMessageRecords = await this.db
      .select({
        favorite: messages.favorite,
        id: messages.id,
        messageGroupId: messages.messageGroupId,
      })
      .from(messages)
      .where(and(eq(messages.userId, this.userId), inArray(messages.messageGroupId, groupIds)))
      .orderBy(asc(messages.createdAt));

    // 3. Query full message data using queryByIds (reuses all transformation logic)
    const allMessageIds = groupMessageRecords.map((m) => m.id as string);
    const fullMessages = await this.queryByIds(allMessageIds, { postProcessUrl });

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
      where: and(eq(threads.id, threadId), eq(threads.userId, this.userId)),
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
      .where(and(eq(agentsToSessions.agentId, agentId), eq(agentsToSessions.userId, this.userId)))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    return associatedSessionId
      ? or(eq(messages.agentId, agentId), eq(messages.sessionId, associatedSessionId))
      : eq(messages.agentId, agentId);
  };

  findById = async (id: string) => {
    return this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), eq(messages.userId, this.userId)),
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
        where: and(eq(messages.id, sourceMessageId), eq(messages.userId, this.userId)),
      });

      return sourceMessage ? [sourceMessage as DBMessageItem] : [];
    }

    // For Continuation type, get the source message first to know its createdAt
    const sourceMessage = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, sourceMessageId), eq(messages.userId, this.userId)),
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
          eq(messages.userId, this.userId),
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

  queryAll = async () => {
    const result = await this.db
      .select()
      .from(messages)
      .orderBy(messages.createdAt)
      .where(eq(messages.userId, this.userId));

    return result as DBMessageItem[];
  };

  queryBySessionId = async (sessionId?: string | null) => {
    const result = await this.db.query.messages.findMany({
      orderBy: [asc(messages.createdAt)],
      where: and(eq(messages.userId, this.userId), this.matchSession(sessionId)),
    });

    return result as DBMessageItem[];
  };

  queryByKeyword = async (keyword: string) => {
    if (!keyword) return [];
    const result = await this.db.query.messages.findMany({
      orderBy: [desc(messages.createdAt)],
      where: and(eq(messages.userId, this.userId), like(messages.content, `%${keyword}%`)),
    });

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
          eq(messages.userId, this.userId),
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
          eq(messages.userId, this.userId),
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
      .where(and(eq(messages.userId, this.userId), isNotNull(messages.model)))
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
          eq(messages.userId, this.userId),
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

  hasMoreThanN = async (n: number): Promise<boolean> => {
    const result = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, this.userId))
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
      .where(eq(messages.userId, this.userId))
      .limit(n);

    return result.length;
  };

  // **************** Create *************** //

  create = async (
    {
      model: fromModel,
      provider: fromProvider,
      files,
      plugin,
      pluginIntervention,
      pluginState,
      fileChunks,
      ragQueryId,
      updatedAt,
      createdAt,
      ...message
    }: CreateMessageParams,
    id: string = this.genId(),
  ): Promise<DBMessageItem> => {
    return this.db.transaction(async (trx) => {
      // Ensure group message does not populate sessionId
      const normalizedMessage = message.groupId ? { ...message, sessionId: null } : message;

      const [item] = (await trx
        .insert(messages)
        .values({
          ...normalizedMessage,
          // TODO: remove this when the client is updated
          createdAt: createdAt ? new Date(createdAt) : undefined,
          id,
          model: fromModel,
          provider: fromProvider,
          updatedAt: updatedAt ? new Date(updatedAt) : undefined,
          userId: this.userId,
        })
        .returning()) as DBMessageItem[];

      // Insert the plugin data if the message is a tool
      if (message.role === 'tool') {
        await trx.insert(messagePlugins).values({
          apiName: plugin?.apiName,
          arguments: plugin?.arguments,
          id,
          identifier: plugin?.identifier,
          intervention: pluginIntervention,
          state: pluginState,
          toolCallId: message.tool_call_id,
          type: plugin?.type,
          userId: this.userId,
        });
      }

      if (files && files.length > 0) {
        await trx
          .insert(messagesFiles)
          .values(files.map((file) => ({ fileId: file, messageId: id, userId: this.userId })));
      }

      if (fileChunks && fileChunks.length > 0 && ragQueryId) {
        await trx.insert(messageQueryChunks).values(
          fileChunks.map((chunk) => ({
            chunkId: chunk.id,
            messageId: id,
            queryId: ragQueryId,
            similarity: chunk.similarity?.toString(),
            userId: this.userId,
          })),
        );
      }

      return item;
    });
  };

  batchCreate = async (newMessages: DBMessageItem[]) => {
    const messagesToInsert = newMessages.map((m) => {
      // TODO: need a better way to handle this
      return { ...m, role: m.role as any, userId: this.userId };
    });

    return this.db.insert(messages).values(messagesToInsert);
  };

  createMessageQuery = async (params: NewMessageQueryParams) => {
    const result = await this.db
      .insert(messageQueries)
      .values({ ...params, userId: this.userId })
      .returning();

    return result[0];
  };
  // **************** Update *************** //

  update = async (
    id: string,
    { imageList, metadata, ...message }: Partial<UpdateMessageParams>,
  ): Promise<{ success: boolean }> => {
    try {
      await this.db.transaction(async (trx) => {
        // 1. insert message files
        if (imageList && imageList.length > 0) {
          await trx
            .insert(messagesFiles)
            .values(
              imageList.map((file) => ({ fileId: file.id, messageId: id, userId: this.userId })),
            );
        }

        // 2. Handle metadata merge if provided
        let mergedMetadata: Record<string, any> | undefined;
        if (metadata) {
          const [existingMessage] = await trx
            .select({ metadata: messages.metadata })
            .from(messages)
            .where(and(eq(messages.id, id), eq(messages.userId, this.userId)));
          mergedMetadata = merge(existingMessage?.metadata || {}, metadata);
        }

        await trx
          .update(messages)
          .set({ ...message, ...(mergedMetadata && { metadata: mergedMetadata }) })
          .where(and(eq(messages.id, id), eq(messages.userId, this.userId)));
      });

      return { success: true };
    } catch (error) {
      console.error('Update message error:', error);
      return { success: false };
    }
  };

  updateMetadata = async (id: string, metadata: Record<string, any>) => {
    const item = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), eq(messages.userId, this.userId)),
    });

    if (!item) return;

    return this.db
      .update(messages)
      .set({ metadata: merge(item.metadata || {}, metadata) })
      .where(and(eq(messages.userId, this.userId), eq(messages.id, id)));
  };

  updatePluginState = async (id: string, state: Record<string, any>): Promise<void> => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, id),
    });
    if (!item) throw new Error('Plugin not found');

    await this.db
      .update(messagePlugins)
      .set({ state: merge(item.state || {}, state) })
      .where(eq(messagePlugins.id, id));
  };

  updateMessagePlugin = async (id: string, value: Partial<MessagePluginItem>) => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, id),
    });
    if (!item) throw new Error('Plugin not found');

    return this.db.update(messagePlugins).set(value).where(eq(messagePlugins.id, id));
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
              where: and(eq(messages.id, id), eq(messages.userId, this.userId)),
            });
            messageUpdateData.metadata = merge(existingMessage?.metadata || {}, metadata);
          }

          if (Object.keys(messageUpdateData).length > 0) {
            await trx
              .update(messages)
              .set(messageUpdateData)
              .where(and(eq(messages.id, id), eq(messages.userId, this.userId)));
          }
        }

        // Update messagePlugins table (pluginState, pluginError)
        if (pluginState !== undefined || pluginError !== undefined) {
          const pluginItem = await trx.query.messagePlugins.findFirst({
            where: eq(messagePlugins.id, id),
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
                .where(eq(messagePlugins.id, id));
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
          .where(and(eq(messagePlugins.toolCallId, toolCallId), eq(messages.userId, this.userId)))
          .limit(1);

        if (!toolResult?.parentId) {
          throw new Error(`No tool message found with toolCallId: ${toolCallId}`);
        }

        // 2. Get parent assistant message's tools
        const [parentMessage] = await trx
          .select({ id: messages.id, tools: messages.tools })
          .from(messages)
          .where(eq(messages.id, toolResult.parentId))
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
            .where(eq(messagePlugins.id, toolResult.toolPluginId)),
          // Update parent assistant message's tools
          trx
            .update(messages)
            .set({ tools: updatedTools })
            .where(eq(messages.id, parentMessage.id)),
        ]);
      });

      return { success: true };
    } catch (error) {
      console.error('Update tool arguments error:', error);
      return { success: false };
    }
  };

  updateTranslate = async (id: string, translate: Partial<ChatTranslate>) => {
    const result = await this.db.query.messageTranslates.findFirst({
      where: and(eq(messageTranslates.id, id)),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTranslates).values({ ...translate, id, userId: this.userId });
    }

    // or just update the existing one
    return this.db.update(messageTranslates).set(translate).where(eq(messageTranslates.id, id));
  };

  updateTTS = async (id: string, tts: Partial<ChatTTS>) => {
    const result = await this.db.query.messageTTS.findFirst({
      where: and(eq(messageTTS.id, id)),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTTS).values({
        contentMd5: tts.contentMd5,
        fileId: tts.file,
        id,
        userId: this.userId,
        voice: tts.voice,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTTS)
      .set({ contentMd5: tts.contentMd5, fileId: tts.file, voice: tts.voice })
      .where(eq(messageTTS.id, id));
  };

  async updateMessageRAG(id: string, { ragQueryId, fileChunks }: UpdateMessageRAGParams) {
    return this.db.insert(messageQueryChunks).values(
      fileChunks.map((chunk) => ({
        chunkId: chunk.id,
        messageId: id,
        queryId: ragQueryId,
        similarity: chunk.similarity?.toString(),
        userId: this.userId,
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
        .where(and(eq(messages.id, id), eq(messages.userId, this.userId)))
        .limit(1);

      // If the message to be deleted is not found, return directly
      if (message.length === 0) return;

      // 2. Update child messages' parentId to the current message's parentId
      // This preserves the tree structure when deleting a node
      await tx
        .update(messages)
        .set({ parentId: message[0].parentId })
        .where(and(eq(messages.parentId, id), eq(messages.userId, this.userId)));

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
        .where(and(eq(messages.userId, this.userId), inArray(messages.id, messageIdsToDelete)));
    });
  };

  deleteMessages = async (ids: string[]) => {
    if (ids.length === 0) return;

    return this.db.transaction(async (tx) => {
      // 1. Query all messages to be deleted with their parentId
      const toDelete = await tx
        .select({ id: messages.id, parentId: messages.parentId })
        .from(messages)
        .where(and(eq(messages.userId, this.userId), inArray(messages.id, ids)));

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
          and(
            eq(messages.userId, this.userId),
            inArray(messages.parentId, ids),
            not(inArray(messages.id, ids)),
          ),
        );

      // 5. Update each child's parentId to the final ancestor
      for (const child of children) {
        const newParentId = finalAncestorMap.get(child.parentId!) ?? null;
        await tx.update(messages).set({ parentId: newParentId }).where(eq(messages.id, child.id));
      }

      // 6. Delete the messages
      await tx
        .delete(messages)
        .where(and(eq(messages.userId, this.userId), inArray(messages.id, ids)));
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
      .where(and(eq(messageTranslates.id, id), eq(messageTranslates.userId, this.userId)));

  deleteMessageTTS = async (id: string) =>
    this.db
      .delete(messageTTS)
      .where(and(eq(messageTTS.id, id), eq(messageTTS.userId, this.userId)));

  deleteMessageQuery = async (id: string) =>
    this.db
      .delete(messageQueries)
      .where(and(eq(messageQueries.id, id), eq(messageQueries.userId, this.userId)));

  deleteMessagesBySession = async (
    sessionId?: string | null,
    topicId?: string | null,
    groupId?: string | null,
  ) =>
    this.db
      .delete(messages)
      .where(
        and(
          eq(messages.userId, this.userId),
          this.matchSession(sessionId),
          this.matchTopic(topicId),
          this.matchGroup(groupId),
        ),
      );

  deleteAllMessages = async () => {
    return this.db.delete(messages).where(eq(messages.userId, this.userId));
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
      .where(and(eq(agentsToSessions.agentId, agentId), eq(agentsToSessions.userId, this.userId)))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    const agentCondition = associatedSessionId
      ? or(eq(messages.agentId, agentId), eq(messages.sessionId, associatedSessionId))
      : eq(messages.agentId, agentId);

    return this.db.delete(messages).where(and(eq(messages.userId, this.userId), agentCondition));
  };

  // **************** Helper *************** //

  private genId = () => idGenerator('messages', 14);

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
}
