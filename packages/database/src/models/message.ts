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
  HeterogeneousToolStateSnapshot,
  IThreadType,
  MessageMetadata,
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
  WorkSummaryItem,
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
  users,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { sanitizeBm25Query } from '../utils/bm25';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { recomputeTopicUsage } from './topicUsage';
import { WorkModel } from './work';

/**
 * Read the operation-final Work root id stamped on a message's metadata by the
 * Work registry (`metadata.work.rootOperationId`). Mirrors the client-side
 * `getOperationFinalRootId` without importing from the app layer.
 */
const getMessageWorkRootId = (metadata: unknown): string | undefined => {
  const rootOperationId = (metadata as { work?: { rootOperationId?: unknown } } | null)?.work
    ?.rootOperationId;
  return typeof rootOperationId === 'string' && rootOperationId ? rootOperationId : undefined;
};

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
  /**
   * Skip the Work-summary assembly (see `QueryMessageParams.skipWorks`).
   */
  skipWorks?: boolean;
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

export interface TopicTranscriptMessage {
  content: string | null;
  createdAt: Date;
  id: string;
  messageGroupId: string | null;
  parentId: string | null;
  role: string;
  threadId: string | null;
  tools: ChatToolPayload[] | null;
}

export interface TopicTranscriptResult {
  items: TopicTranscriptMessage[];
  total: number;
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

/**
 * Shared, ownership-scoped filters for the analytics queries
 * (count / countGroupByTopic / topicMessageStats). All of these are
 * applied on top of the workspace ownership predicate, so the resulting
 * query never leaks across `userId × workspace`.
 */
export interface MessageAnalyticsFilters {
  agentId?: string;
  endDate?: string;
  range?: [string, string];
  role?: string;
  startDate?: string;
  topicId?: string;
}

/** A single `{ topicId, count }` row from a per-topic count aggregation. */
export interface TopicMessageCountItem {
  count: number;
  topicId: string;
}

/**
 * Distribution of message counts per topic, computed server-side.
 * Mirrors what a `SELECT count(*) ... GROUP BY topic_id` + percentile
 * aggregation would produce, so the CLI receives only the summary instead
 * of paginating raw rows.
 */
export interface TopicMessageStats {
  /** Per distinct message-count value, how many topics have it. Ascending. */
  histogram: { topics: number; userCount: number }[];
  max: number;
  mean: number;
  median: number;
  min: number;
  /** Number of topics with exactly one matching message ("one-shot"). */
  oneshot: number;
  /** oneshot / topics, in [0, 1]. 0 when there are no topics. */
  oneshotRatio: number;
  p90: number;
  p99: number;
  /** Number of topics that have at least one matching message. */
  topics: number;
  /** Total matching messages across all topics. */
  totalMessages: number;
}

/**
 * Linear-interpolation percentile over an ascending-sorted array, matching
 * PostgreSQL's `percentile_cont`. Returns 0 for an empty input.
 */
const percentileCont = (sorted: number[], q: number): number => {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = q * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
};

/** Reduce a list of per-topic message counts into a {@link TopicMessageStats}. */
const computeTopicMessageStats = (counts: number[]): TopicMessageStats => {
  const topics = counts.length;
  if (topics === 0) {
    return {
      histogram: [],
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      oneshot: 0,
      oneshotRatio: 0,
      p90: 0,
      p99: 0,
      topics: 0,
      totalMessages: 0,
    };
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const totalMessages = sorted.reduce((acc, c) => acc + c, 0);
  const oneshot = sorted.filter((c) => c === 1).length;

  const bucket = new Map<number, number>();
  for (const c of sorted) bucket.set(c, (bucket.get(c) ?? 0) + 1);
  const histogram = [...bucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([userCount, topicCount]) => ({ topics: topicCount, userCount }));

  return {
    histogram,
    max: sorted[topics - 1],
    mean: totalMessages / topics,
    median: percentileCont(sorted, 0.5),
    min: sorted[0],
    oneshot,
    oneshotRatio: oneshot / topics,
    p90: percentileCont(sorted, 0.9),
    p99: percentileCont(sorted, 0.99),
    topics,
    totalMessages,
  };
};

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
      skipWorks,
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
        skipWorks,
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
        skipWorks,
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
      skipWorks,
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
   * Return a lightweight, ownership-scoped transcript for a topic.
   *
   * Unlike the conversation query, this intentionally does not infer missing
   * session, group, or thread filters as `IS NULL`, and it does not replace raw
   * message-group members with synthetic nodes. Consumers such as the CLI need
   * the complete persisted transcript and exact database pagination.
   */
  queryTopicTranscript = async ({
    limit,
    offset,
    topicId,
  }: {
    limit: number;
    offset: number;
    topicId: string;
  }): Promise<TopicTranscriptResult> => {
    const where = and(this.ownership(), eq(messages.topicId, topicId));

    const [items, totalResult] = await Promise.all([
      this.db
        .select({
          content: messages.content,
          createdAt: messages.createdAt,
          id: messages.id,
          messageGroupId: messages.messageGroupId,
          parentId: messages.parentId,
          role: messages.role,
          threadId: messages.threadId,
          tools: messages.tools,
        })
        .from(messages)
        .where(where)
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count(messages.id) })
        .from(messages)
        .where(where),
    ]);

    return {
      items: items.map(({ tools, ...message }) => ({
        ...message,
        tools: Array.isArray(tools) ? (tools as ChatToolPayload[]) : null,
      })),
      total: totalResult[0]?.count ?? 0,
    };
  };

  /**
   * Lightweight parent/group links for the FULL message tree of a topic,
   * INCLUDING messages hidden inside MessageGroups (compression / parallel).
   *
   * `query` replaces grouped messages with synthetic group nodes that expose
   * neither their members' `parentId` nor (for compaction) the group's
   * `parentMessageId`, so branch-ancestry can't be reconstructed from `query`
   * output alone. This returns the raw `id → parentId` / `messageGroupId` links
   * so callers (e.g. server-runtime regenerate pruning) can walk ancestry across
   * a compacted range.
   */
  queryTopicMessageTree = async ({
    threadId,
    topicId,
  }: {
    threadId?: string | null;
    topicId: string;
  }): Promise<{ id: string; messageGroupId: string | null; parentId: string | null }[]> => {
    return this.db
      .select({
        id: messages.id,
        messageGroupId: messages.messageGroupId,
        parentId: messages.parentId,
      })
      .from(messages)
      .where(and(this.ownership(), this.matchTopic(topicId), this.matchThread(threadId)));
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
    const {
      where,
      current = 0,
      pageSize = 1000,
      postProcessUrl,
      skipWorks,
      topicId,
      timing,
    } = options;
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

            sender: {
              avatar: users.avatar,
              fullName: users.fullName,
              id: users.id,
              username: users.username,
            },

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
          .leftJoin(users, eq(users.id, messages.userId))
          // Page from the NEWEST messages, not the oldest. `desc` + limit/offset
          // fetches the most recent `pageSize` rows, so a topic with more than
          // `pageSize` mainline messages keeps its latest turns (including the
          // final answer) instead of silently dropping them — the previous
          // `asc + limit` truncated exactly the newest batch, which is the worst
          // possible slice for a chat transcript. The page is reversed back to
          // ascending immediately below, so every downstream consumer is
          // unaffected; only *which* rows are fetched changed. See LOBE-12011.
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(pageSize)
          .offset(offset),
      { current, pageSize },
    );
    logTiming(timing, 'db.message.queryWithWhere.baseSelect:rows', { rowCount: result.length });

    // Restore ascending (createdAt, id) order so downstream assembly — the
    // MessageGroup time window, work-summary anchoring, and the final merge sort —
    // behaves exactly as before the newest-first fetch above.
    result.reverse();

    // When the newest page is truncated (it filled `pageSize`), its oldest rows
    // may sit mid-round. The renderer roots a slice at a single parent, so a slice
    // cut inside a round can strand sibling chains and drop them from the screen.
    // Align the lower boundary to a round start — a mainline `user` message — so
    // the slice is one contiguous chain. Never trim to empty: an oversized single
    // round with no user message in view is kept whole (the proper fix for those
    // is lazy step loading). Thread queries pass no `topicId` and are untouched.
    //
    // Scope: this only serves the single "most recent page" load (`current === 0`),
    // which is the only page the chat read path ever requests — `current`/`pageSize`
    // offset paging is dead code here (the very premise of LOBE-12011). The trim is
    // deliberately NOT offset-exact: the rows it drops from page 0 also fall outside
    // page 1's `offset = pageSize` window, so a hypothetical offset walk would skip
    // them. That is acceptable because nothing offset-walks this path; loading older
    // history is round-cursor based (see the follow-up), which supersedes offset
    // paging entirely and closes that gap by construction.
    if (topicId && current === 0 && result.length >= pageSize) {
      const firstRoundStart = result.findIndex((message) => message.role === 'user');
      if (firstRoundStart > 0) result.splice(0, firstRoundStart);
    }

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
      worksByMessageId,
    ] = await Promise.all([
      messageGroupNodesPromise,
      this.queryMessageFileRelations(messageIds, postProcessUrl, timing),
      this.queryMessageChunkRelations(messageIds, timing),
      this.queryMessageQueryRelations(messageIds, timing),
      this.queryMessageThreadRelations(taskMessageIds, timing),
      skipWorks
        ? ({} as Record<string, WorkSummaryItem[]>)
        : this.queryMessageWorkSummaries(result, timing),
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
          ({
            model,
            provider,
            translate,
            ttsId,
            ttsFile,
            ttsContentMd5,
            ttsVoice,
            sender,
            ...item
          }) => {
            const messageQuery = messageQueriesList.find(
              (relation) => relation.messageId === item.id,
            );
            return {
              ...item,
              // LEFT JOIN → users row is null only when the sender account was
              // deleted (rare, since `messages.user_id` cascades on user delete).
              // Collapse a null-id sender to `null` so the client can rely on
              // `sender?.id` as the presence check.
              sender: sender?.id ? sender : null,
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

                .map<ChatFileItem>(({ id, url, size, fileType, name }) =>
                  // Nulled by the visibility guard: the viewer lost access to
                  // the referenced file. Emit a tombstone (id only) so the UI
                  // renders a no-access placeholder.
                  name === null
                    ? { fileType: '', id, inaccessible: true, name: '', size: 0, url: '' }
                    : {
                        content: documentsMap[id],
                        fileType: fileType!,
                        id,
                        name,
                        size: size!,
                        url,
                      },
                ),
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
              // Work summaries for this message's root operation, resolved
              // server-side (attached only to the round's anchor message).
              works: worksByMessageId[item.id as string],
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
          // Guard the referenced file, not just the relation: in a shared
          // conversation (chat group / workspace task) the message is visible
          // to every member, but a file its owner switched back to private
          // must degrade to a tombstone (id only) instead of leaking
          // name/size/url. Same anti-leak join pattern as the agent knowledge
          // reads in agent.ts.
          .leftJoin(
            files,
            and(
              eq(files.id, messagesFiles.fileId),
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
            ),
          )
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
          rawRelatedFileList.map(async (file) => {
            // Tombstoned by the visibility guard above — nothing to presign.
            if (file.name === null) return { ...file, url: '' };
            return {
              ...file,
              url: postProcessUrl
                ? await postProcessUrl(
                    file.url,
                    file as unknown as { fileType: string; id?: string | null },
                  )
                : (file.url as string),
            };
          }),
        ),
      { fileCount: rawRelatedFileList.length },
    );

    // Exclude tombstoned files — their parsed document content must not leak
    // through the unguarded documents join below.
    const fileIds = relatedFileList
      .filter((file) => file.name !== null)
      .map((file) => file.id)
      .filter(Boolean);

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
          // Guard the referenced file like queryMessageFileRelations: in a
          // shared conversation, RAG reference chunks of a file its owner
          // switched back to private must not leak filename/url/text to other
          // members. The inner join drops those chunk rows entirely.
          .innerJoin(
            files,
            and(
              eq(fileChunks.fileId, files.id),
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
            ),
          )
          .where(inArray(messageQueryChunks.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.chunks.select:rows', {
      rowCount: chunksList.length,
    });

    return chunksList;
  };

  /**
   * Resolve Work summaries for a page of messages and key them by anchor
   * message id — the LAST message (rows are createdAt-asc, so last occurrence)
   * carrying each `metadata.work.rootOperationId`. Works ride the message-list
   * payload so the in-message Works chips and the sidebar summary read from one
   * source instead of a dedicated work-summary fetch. Attaching only to the
   * round's last message (not every row sharing the operation) keeps the
   * payload flat — the client re-keys by `rootOperationId`, so which row
   * physically carries it doesn't matter.
   */
  private queryMessageWorkSummaries = async (
    rows: { id: unknown; metadata: unknown }[],
    timing?: ModelTimingContext,
  ): Promise<Record<string, WorkSummaryItem[]>> => {
    const anchorByRootId = new Map<string, string>();
    for (const row of rows) {
      const rootOperationId = getMessageWorkRootId(row.metadata);
      if (rootOperationId) anchorByRootId.set(rootOperationId, row.id as string);
    }
    if (anchorByRootId.size === 0) return {};

    const summaryMap = await runTimedStage(
      timing,
      'db.message.queryWithWhere.workSummaries',
      () =>
        new WorkModel(this.db, this.userId, this.workspaceId).listSummariesByRootOperations({
          rootOperationIds: Array.from(anchorByRootId.keys()),
        }),
      { rootOperationCount: anchorByRootId.size },
    );

    const worksByMessageId: Record<string, WorkSummaryItem[]> = {};
    for (const [rootOperationId, messageId] of anchorByRootId) {
      const works = summaryMap[rootOperationId];
      if (works && works.length > 0) worksByMessageId[messageId] = works;
    }
    logTiming(timing, 'db.message.queryWithWhere.workSummaries:rows', {
      messageCount: Object.keys(worksByMessageId).length,
    });
    return worksByMessageId;
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
        // Same anti-leak guard as queryMessageFileRelations: tombstone files
        // the viewer lost access to instead of leaking name/size/url.
        .leftJoin(
          files,
          and(
            eq(files.id, messagesFiles.fileId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
          ),
        )
        .where(inArray(messagesFiles.messageId, messageIds)),

      // 2b. Get related file chunks (visibility-guarded like queryWithWhere)
      this.queryMessageChunkRelations(messageIds),

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
      rawRelatedFileList.map(async (file) => {
        // Tombstoned by the visibility guard above — nothing to presign.
        if (file.name === null) return { ...file, url: '' };
        return {
          ...file,
          url: postProcessUrl
            ? await postProcessUrl(
                file.url,
                file as unknown as { fileType: string; id?: string | null },
              )
            : (file.url as string),
        };
      }),
    );

    // Get associated document content. Exclude tombstoned files — their parsed
    // document content must not leak through the unguarded documents join.
    const fileIds = relatedFileList
      .filter((file) => file.name !== null)
      .map((file) => file.id)
      .filter(Boolean);

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
            .map<ChatFileItem>(({ id, url, size, fileType, name }) =>
              // Nulled by the visibility guard: the viewer lost access to the
              // referenced file. Emit a tombstone (id only) so the UI renders
              // a no-access placeholder.
              name === null
                ? { fileType: '', id, inaccessible: true, name: '', size: 0, url: '' }
                : {
                    content: documentsMap[id],
                    fileType: fileType!,
                    id,
                    name,
                    size: size!,
                    url,
                  },
            ),
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

  findLatestAssistantMessageByThread = async ({
    agentId,
    threadId,
    topicId,
  }: {
    agentId: string;
    threadId: string;
    topicId: string;
  }) =>
    this.db.query.messages.findFirst({
      orderBy: [desc(messages.createdAt), desc(messages.id)],
      where: and(
        this.ownership(),
        eq(messages.agentId, agentId),
        eq(messages.topicId, topicId),
        eq(messages.threadId, threadId),
        eq(messages.role, 'assistant'),
      ),
    });

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

  /**
   * Ownership-scoped analytics filter conditions, shared by count /
   * countGroupByTopic / topicMessageStats. The first entry is always the
   * `userId × workspace` ownership predicate; later entries are optional.
   */
  private analyticsConditions = (params?: MessageAnalyticsFilters) => [
    this.ownership(),
    params?.agentId ? eq(messages.agentId, params.agentId) : undefined,
    params?.topicId ? eq(messages.topicId, params.topicId) : undefined,
    params?.role ? eq(messages.role, params.role) : undefined,
    params?.range
      ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
      : undefined,
    params?.endDate
      ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
      : undefined,
    params?.startDate
      ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
      : undefined,
  ];

  count = async (params?: MessageAnalyticsFilters): Promise<number> => {
    const result = await this.db
      .select({
        count: count(messages.id),
      })
      .from(messages)
      .where(genWhere(this.analyticsConditions(params)));

    return result[0].count;
  };

  /**
   * Count matching messages grouped by topic, sorted by count desc.
   * Topics without a `topicId` are excluded. Pushes the GROUP BY to the DB
   * so callers don't have to paginate raw rows and count client-side.
   */
  countGroupByTopic = async (
    params?: MessageAnalyticsFilters,
  ): Promise<TopicMessageCountItem[]> => {
    const rows = await this.db
      .select({
        count: count(messages.id),
        topicId: messages.topicId,
      })
      .from(messages)
      .where(genWhere([...this.analyticsConditions(params), isNotNull(messages.topicId)]))
      .groupBy(messages.topicId)
      .orderBy(desc(sql`count`), asc(messages.topicId));

    return rows.map((r) => ({ count: r.count, topicId: r.topicId! }));
  };

  /**
   * Distribution of message counts per topic (topics / mean / median /
   * p90 / p99 / min / max / one-shot ratio + histogram). The per-topic
   * counts are aggregated in the DB; only the final summary is returned.
   */
  topicMessageStats = async (params?: MessageAnalyticsFilters): Promise<TopicMessageStats> => {
    const rows = await this.db
      .select({
        count: count(messages.id),
        topicId: messages.topicId,
      })
      .from(messages)
      .where(genWhere([...this.analyticsConditions(params), isNotNull(messages.topicId)]))
      .groupBy(messages.topicId);

    return computeTopicMessageStats(rows.map((r) => r.count));
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
  listMessagePluginsByTopic = async (
    topicId: string,
  ): Promise<Array<MessagePluginItem & { metadata?: MessageMetadata }>> => {
    const rows = await this.db
      .select({
        apiName: messagePlugins.apiName,
        arguments: messagePlugins.arguments,
        clientId: messagePlugins.clientId,
        error: messagePlugins.error,
        id: messagePlugins.id,
        identifier: messagePlugins.identifier,
        intervention: messagePlugins.intervention,
        metadata: messages.metadata,
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
      metadata: row.metadata ?? undefined,
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
      heterogeneousToolState?: HeterogeneousToolStateSnapshot;
      metadata?: Record<string, any>;
      pluginError?: any;
      pluginState?: Record<string, any>;
    },
  ): Promise<{ applied: boolean; snapshotSeq?: number; success: boolean }> => {
    const { content, heterogeneousToolState, metadata, pluginState, pluginError } = params;

    // `undefined` while no branch has looked for the row yet; see `update` above
    // for why a write that matches nothing must not report success.
    let matchedRow: boolean | undefined;
    let applied = true;
    let snapshotSeq: number | undefined;

    try {
      await this.db.transaction(async (trx) => {
        let existingMetadata: Record<string, any> | undefined;

        if (metadata !== undefined || heterogeneousToolState !== undefined) {
          const baseQuery = trx
            .select({ metadata: messages.metadata })
            .from(messages)
            .where(and(eq(messages.id, id), this.ownership()))
            .limit(1);
          const [existingMessage] = heterogeneousToolState
            ? await baseQuery.for('update')
            : await baseQuery;

          matchedRow = !!existingMessage;
          if (!existingMessage) return;

          existingMetadata = (existingMessage.metadata ?? {}) as Record<string, any>;

          if (heterogeneousToolState) {
            const currentOperationId = existingMetadata.heterogeneousToolStateOperationId;
            const rawCurrentSeq = existingMetadata.heterogeneousToolStateSeq;
            const currentSeq =
              currentOperationId === heterogeneousToolState.operationId &&
              typeof rawCurrentSeq === 'number' &&
              Number.isFinite(rawCurrentSeq)
                ? rawCurrentSeq
                : 0;

            if (heterogeneousToolState.snapshotSeq <= currentSeq) {
              applied = false;
              snapshotSeq = currentSeq;
              return;
            }

            snapshotSeq = heterogeneousToolState.snapshotSeq;
          }
        }

        // Update messages table (content, metadata)
        if (
          content !== undefined ||
          metadata !== undefined ||
          heterogeneousToolState !== undefined
        ) {
          const messageUpdateData: Record<string, any> = {};

          if (content !== undefined) {
            messageUpdateData.content = content;
          }

          if (metadata !== undefined || heterogeneousToolState !== undefined) {
            const mergedMetadata = merge(existingMetadata || {}, metadata || {});
            messageUpdateData.metadata = heterogeneousToolState
              ? merge(mergedMetadata, {
                  heterogeneousToolStateOperationId: heterogeneousToolState.operationId,
                  heterogeneousToolStateSeq: heterogeneousToolState.snapshotSeq,
                })
              : mergedMetadata;
          }

          if (Object.keys(messageUpdateData).length > 0) {
            const [updated] = await trx
              .update(messages)
              .set(messageUpdateData)
              .where(and(eq(messages.id, id), this.ownership()))
              .returning({ id: messages.id });

            matchedRow = !!updated;
          }
        }

        // Update messagePlugins table (pluginState, pluginError)
        if (pluginState !== undefined || pluginError !== undefined) {
          const pluginItem = await trx.query.messagePlugins.findFirst({
            where: and(eq(messagePlugins.id, id), this.pluginsOwnership()),
          });

          // A plugin-only patch never touches `messages`, so the plugin row is
          // the only evidence the tool message exists.
          if (matchedRow === undefined) matchedRow = !!pluginItem;

          if (pluginItem) {
            const pluginUpdateData: Record<string, any> = {};

            if (pluginState !== undefined) {
              pluginUpdateData.state = heterogeneousToolState
                ? pluginState
                : merge(pluginItem.state || {}, pluginState);
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
          } else if (heterogeneousToolState) {
            throw new Error(`No tool plugin matched id ${id}`);
          }
        }
      });

      if (matchedRow === false) {
        console.error(`Update tool message error: no tool message matched id ${id}`);
        return { applied: false, success: false };
      }

      return { applied, snapshotSeq, success: true };
    } catch (error) {
      console.error('Update tool message error:', error);
      return { applied: false, success: false };
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
   * Excludes `role:'tool'` (inline children) and TOOLLESS signal-tagged
   * assistants (`metadata->'signal'` with no tools), which are tool-child
   * callbacks — anchoring a normal turn onto a callback would orphan it under
   * the read side's tool-only signal collection. A signal turn that DID emit
   * tools is back on the main chain and stays a spine candidate.
   */
  getLastMainThreadSpineMessageId = async (topicId: string): Promise<string | undefined> =>
    this.getLatestSpineMessageId({ topicId, threadId: null });

  /**
   * Thread-aware variant of {@link getLastMainThreadSpineMessageId}: the id of
   * the latest "spine" message (the most recent message that is NOT a tool and
   * NOT a signal-tagged reactive turn) in a topic, scoped to the main thread
   * (`threadId IS NULL`) or to a specific thread.
   *
   * Like the main-thread query it EXCLUDES `role:'tool'` and TOOLLESS
   * signal-tagged assistants: tools are inline children of their assistant turn,
   * so the conversation head a new turn parents off is the assistant, never the
   * tool result that landed under it. A tools-bearing signal turn is main-chain
   * and remains a spine candidate.
   *
   * Used by `sendMessageInServer` to make `parentId` server-authoritative and
   * close the concurrent-append race: the client computes `parentId` from a
   * local snapshot whose spine tail may already have advanced (e.g. another
   * assistant turn was written while the user was composing), so trusting it
   * would fork the new turn off a stale node. Ordering by `createdAt` is safe
   * because a topic runs at most one operation at a time.
   */
  getLatestSpineMessageId = async ({
    topicId,
    threadId,
  }: {
    threadId?: string | null;
    topicId: string;
  }): Promise<string | undefined> => {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          not(eq(messages.role, 'tool')),
          threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId),
          // Exclude signal-tagged assistants — BUT only the toolless ones. The
          // writer tags a turn `signal` at stream_start before it knows the turn
          // will call tools; a signal turn that DOES emit a tool_use is really
          // back on the main chain (see `reduceToolsChunk`'s spine promotion),
          // so it must stay a spine candidate or a cold replica re-forks the
          // wire off the pre-signal turn. Match the read side, which likewise
          // treats a tools-bearing message as non-signal (`getMessageSignal`).
          //
          // Key existence (`jsonb_exists`) is used instead of `metadata -> 'signal'
          // IS NULL`, which crashes the serverless Postgres engine as a WHERE
          // predicate (rt_fetch out-of-bounds, SQLSTATE XX000 — the `->` operator
          // only survives in SELECT/ORDER BY). Toolless is expressed with plain
          // jsonb equality (`= '[]'` / IS NULL) rather than `jsonb_array_length`,
          // which is unproven on this engine as a qual.
          sql`NOT (
            COALESCE(jsonb_exists(${messages.metadata}, 'signal'), false)
            AND (${messages.tools} IS NULL OR ${messages.tools} = '[]'::jsonb)
          )`,
          this.ownership(),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return row?.id;
  };

  /**
   * Fallback anchor for {@link getLatestSpineMessageId}: the latest non-tool
   * message in a topic/thread, WITHOUT the toolless-signal exclusion.
   *
   * A topic whose main thread holds nothing but toolless signal turns has no
   * spine candidate, so the spine lookup returns undefined and the caller would
   * persist the new turn with `parentId: undefined` — a second root that forks
   * the conversation tree. The renderer walks that forest depth-first, so an
   * earlier root's long-running subtree gets emitted before a later root and the
   * newest reply surfaces ABOVE older messages (LOBE-11489).
   *
   * `role:'tool'` stays excluded: tool results are inline children of their
   * assistant turn, and anchoring a normal turn onto one orphans it under the
   * read side's tool-only signal collection.
   */
  getLatestNonToolMessageId = async ({
    topicId,
    threadId,
  }: {
    threadId?: string | null;
    topicId: string;
  }): Promise<string | undefined> => {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          not(eq(messages.role, 'tool')),
          threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId),
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
    const { contentMd5, file, voice } = tts;
    // Older clients sent an empty payload when starting TTS, so keep this backward-compatible.
    if ([contentMd5, file, voice].every((value) => value === undefined)) return;

    const result = await this.db.query.messageTTS.findFirst({
      where: and(eq(messageTTS.id, id), this.ttsOwnership()),
    });

    // If the message does not exist in the TTS table, insert it
    if (!result) {
      return this.db.insert(messageTTS).values({
        contentMd5,
        fileId: file,
        id,
        userId: this.userId,
        voice,
        workspaceId: this.workspaceId ?? null,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTTS)
      .set({ contentMd5, fileId: file, voice })
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

    // The insert below has no ownership predicate of its own, so verify the
    // target message is actually visible to this user/workspace first —
    // otherwise a caller could attach files to another tenant's message.
    const message = await this.findById(messageId);
    if (!message) return { success: false };

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
