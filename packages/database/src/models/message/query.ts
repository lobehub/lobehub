import type {
  ChatMessageError,
  ChatToolPayload,
  MessageMetadata,
  QueryMessageParams,
  UIChatMessage,
  WorkAccessScope,
} from '@lobechat/types';
import {
  getDurationMs,
  logTimingSink as logTiming,
  runTimedSinkStage as runTimedStage,
} from '@lobechat/utils';
import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import { messagePlugins, messages } from '../../schemas';
import { notShareVisitorMessage } from '../../utils/shareVisitor';
import { nonNull } from '../utils/rows';
import { resolveCursorPageWindow } from './cursorWindow';
import type { MessageLookupQueries } from './lookup';
import type { MessagePageQueries } from './queryWithWhere';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';
import type {
  ModelTimingContext,
  QueryTopicByCursorParams,
  TopicMessagesByCursorResult,
  TopicTranscriptResult,
  VisitorRedactionOptions,
} from './types';
import { toVisitorMessage } from './visitor';

/** Default rounds per cursor page. */
const DEFAULT_ROUND_LIMIT = 10;
/** Default safety cap on rows scanned per cursor page. */
const DEFAULT_ROUND_COUNT_BUDGET = 2000;
/**
 * Row ceiling for the cursor path's underlying `queryWithWhere` fetch. The `where`
 * already bounds rows to the resolved round window; this only prevents an
 * unbounded scan and keeps `queryWithWhere`'s newest-first trim disabled (the
 * result stays below `pageSize`, so the trim guard never fires).
 */
const CURSOR_PAGE_CEILING = 100_000;

export class MessageConversationQueries extends MessageScope {
  private readonly lookups: MessageLookupQueries;
  private readonly page: MessagePageQueries;

  constructor(
    args: MessageScopeArgs,
    deps: { lookups: MessageLookupQueries; page: MessagePageQueries },
  ) {
    super(...args);
    this.lookups = deps.lookups;
    this.page = deps.page;
  }

  /**
   * The newest user message of each given topic, keyed by topic id. Used to
   * pre-inject recent same-channel history for IM platforms that can't read
   * chat history at runtime (e.g. WeChat). Only `role = 'user'` rows with
   * non-empty text are considered.
   */
  queryLastUserMessageByTopics = async (topicIds: string[]): Promise<Map<string, string>> => {
    if (topicIds.length === 0) return new Map();

    const rows = await this.db
      .selectDistinctOn([messages.topicId], {
        content: messages.content,
        topicId: messages.topicId,
      })
      .from(messages)
      .where(
        and(
          this.ownership(),
          inArray(messages.topicId, topicIds),
          eq(messages.role, 'user'),
          isNotNull(messages.content),
          ne(messages.content, ''),
        ),
      )
      .orderBy(messages.topicId, desc(messages.createdAt));

    const result = new Map<string, string>();
    for (const row of rows) {
      // The WHERE clause filters both `content` and `topicId` to non-NULL.
      const content = nonNull(row.content, 'messages.content').trim();
      if (content) result.set(nonNull(row.topicId, 'messages.topic_id'), content);
    }
    return result;
  };

  /**
   * Query messages by params (high-level API)
   *
   * This is the main query method that handles common query patterns.
   * For custom queries, use `queryWithWhere` directly.
   */
  query = async (
    {
      agentId,
      before,
      current = 0,
      includeFileWorks,
      pageSize = 1000,
      sessionId,
      skipWorks,
      topicId,
      groupId,
      threadId,
    }: QueryMessageParams = {},
    options: {
      /**
       * Opt IN to agent-share visitor messages. Visitor conversations persist
       * under the CREATOR's `userId` (only `topics.senderId` marks them), so
       * `this.ownership()` alone lets a creator read a visitor's full transcript
       * by passing its `topicId` — bypassing `allowCreatorViewSessions=false`.
       * Defaults to false so every creator-facing caller fails closed; only the
       * share-scoped read path ({@link MessageModel.queryForVisitor}) sets it.
       */
      allowShareVisitor?: boolean;
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
      timing?: ModelTimingContext;
      /** See {@link QueryMessagesOptions.workAccessScope}. */
      workAccessScope?: WorkAccessScope;
    } = {},
  ) => {
    const queryStartedAt = Date.now();
    // Effective visitor gate: per-call `allowShareVisitor` OR the instance's
    // `includeShareVisitor`. Combined so `queryForVisitor(...)` still works
    // on a default-scoped instance (its explicit param overrides), AND a
    // share-runtime instance stops needing the param at every call site.
    const includeVisitor = options.allowShareVisitor || this.includeShareVisitor;
    const timing = options.timing;

    // Topic-scope shortcut: when the caller pins a `topicId` and hasn't opted
    // in to visitor rows, resolve the topic's `senderId` ONCE and either fail
    // closed (visitor topic) or drop the per-row NOT EXISTS predicate that
    // `queryWithWhere` / `queryMessageGroupNodes` would otherwise re-check for
    // every message in the topic. Every row inside a topic shares its parent
    // topic's visitor/creator identity, so a single indexed topic lookup is
    // strictly stronger than the correlated subquery repeated per row.
    let topicScopeVerified = false;
    if (topicId && !includeVisitor) {
      const scope = await this.resolveTopicVisitorScope(topicId);
      if (scope === 'visitor') {
        logTiming(timing, 'db.message.query:done', {
          messageCount: 0,
          stageMs: getDurationMs(queryStartedAt),
        });
        return [];
      }
      topicScopeVerified = true;
    }
    // `queryWithWhere` already ANDs `notShareVisitorMessage()` via
    // `ownership()`, so the previous per-branch `shareVisitorCondition` in
    // the `where` was pure duplication — dropped. When `topicScopeVerified`
    // is true the predicate is redundant altogether (the topic has been
    // classified once), and we pass that verdict downstream via
    // `allowShareVisitor: effectiveIncludeVisitor` so `queryWithWhere` swaps
    // its scope from `ownership()` to `workspaceScope()` and skips the
    // per-row NOT EXISTS.
    const effectiveIncludeVisitor = includeVisitor || topicScopeVerified;
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
        () => this.lookups.buildAgentCondition(agentId),
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
        () => this.lookups.buildThreadQueryCondition(threadId),
        { hasThreadId: true },
      );
      // A topic thread may contain replies from delegated agents. When the topic is known,
      // scope the complete thread to it instead of filtering those replies by the parent agent.
      const threadScopeCondition = topicId ? this.matchTopic(topicId) : agentCondition;
      const messageItems = await this.page.queryWithWhere({
        allowShareVisitor: effectiveIncludeVisitor,
        before,
        current,
        includeFileWorks,
        pageSize,
        postProcessUrl: options.postProcessUrl,
        skipWorks,
        timing,
        topicId: topicId ?? undefined,
        workAccessScope: options.workAccessScope,
        where: and(threadScopeCondition, threadCondition),
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

      const messageItems = await this.page.queryWithWhere({
        allowShareVisitor: effectiveIncludeVisitor,
        before,
        current,
        includeFileWorks,
        pageSize,
        postProcessUrl: options.postProcessUrl,
        skipWorks,
        timing,
        topicId: topicId ?? undefined,
        workAccessScope: options.workAccessScope,
        where: whereCondition,
      });
      logTiming(timing, 'db.message.query:done', {
        messageCount: messageItems.length,
        stageMs: getDurationMs(queryStartedAt),
      });
      return messageItems;
    }

    // A concrete topic is the conversation boundary and may legitimately
    // contain messages from multiple agents (for example callAgent replies).
    // Inbox queries have no topic, so they still require agent/session scope.
    const conversationCondition = topicId
      ? this.matchTopic(topicId)
      : and(agentCondition ?? this.matchSession(sessionId), this.matchTopic(topicId));

    // Standard query with conversation/topic/group filters
    const whereCondition = and(
      conversationCondition,
      this.matchGroup(groupId),
      this.matchThread(threadId),
    );

    const messageItems = await this.page.queryWithWhere({
      allowShareVisitor: effectiveIncludeVisitor,
      before,
      current,
      includeFileWorks,
      pageSize,
      postProcessUrl: options.postProcessUrl,
      skipWorks,
      timing,
      topicId: topicId ?? undefined,
      where: whereCondition,
      workAccessScope: options.workAccessScope,
    });
    logTiming(timing, 'db.message.query:done', {
      messageCount: messageItems.length,
      stageMs: getDurationMs(queryStartedAt),
    });
    return messageItems;
  };

  /**
   * Visitor-facing twin of {@link query} for agent-share reads.
   *
   * Share messages persist under the CREATOR's account (see `shareChat.ts`),
   * so `query()`'s joined `sender` and the billing/model-snapshot fields
   * describe the creator, not the visitor reading them. `redaction` carries the
   * share's own `showModelInfo` / `showErrorDetails` switches; omitting it
   * strips everything (fail closed).
   */
  queryForVisitor = async (
    params: QueryMessageParams = {},
    options: {
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
      redaction?: VisitorRedactionOptions;
      timing?: ModelTimingContext;
      /**
       * The visitor's share scope for Work summaries. Omitting it skips Work
       * assembly entirely (fail closed): the ordinary scope would join the
       * CREATOR's Works, which must never reach a visitor surface.
       */
      workAccessScope?: WorkAccessScope;
    } = {},
  ): Promise<UIChatMessage[]> => {
    // The only caller allowed past `query()`'s visitor guard: the topic was
    // already resolved and authorized as this visitor's own share topic.
    const messageItems = await this.query(
      { ...params, skipWorks: params.skipWorks || !options.workAccessScope },
      { ...options, allowShareVisitor: true },
    );
    return messageItems.map((message) => toVisitorMessage(message, options.redaction));
  };

  /**
   * Exact per-topic turn count for one role, used by `maxTurnsPerTopic`.
   *
   * MUST NOT reuse {@link MessageModel.count}: its `analyticsConditions()` ANDs
   * in `notShareVisitorMessage()`, which excludes every message whose topic has
   * a non-null `senderId` — i.e. every agent-share visitor topic. That
   * predicate is correct for personal analytics (visitor usage is reported
   * separately), but it would make `count()` return 0 forever for a share
   * topic, silently disabling the turn cap.
   *
   * Safe without a visitor/ownership check here: the caller (shareChat router /
   * `reserveShareVisitorTurn`) already resolved and authorized the topic, and
   * `this.ownership()` matches because share messages carry the creator's
   * `userId` (the model is constructed with `share.ownerId`).
   */
  countByTopic = async ({ role, topicId }: { role: string; topicId: string }): Promise<number> => {
    const result = await this.db
      .select({ count: count(messages.id) })
      .from(messages)
      .where(and(this.ownership(), eq(messages.topicId, topicId), eq(messages.role, role)));

    return result[0].count;
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
    // Creator-facing only (CLI / topic transcript router): agent-share visitor
    // messages live under the creator's `userId`, so ownership alone would hand
    // the creator a visitor's full transcript from a raw topic id.
    const where = and(this.ownership(), eq(messages.topicId, topicId), notShareVisitorMessage());

    const [items, totalResult] = await Promise.all([
      this.db
        .select({
          agentId: messages.agentId,
          error: messages.error,
          metadata: messages.metadata,
          model: messages.model,
          pluginError: messagePlugins.error,
          provider: messages.provider,
          reasoning: messages.reasoning,
          toolCallId: messagePlugins.toolCallId,
          usage: messages.usage,
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
        .leftJoin(messagePlugins, and(eq(messagePlugins.id, messages.id), this.pluginsOwnership()))
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
      items: items.map(({ tools, usage, ...message }) => ({
        ...message,
        error: message.error as ChatMessageError | null,
        metadata: message.metadata as MessageMetadata | null,
        tools: Array.isArray(tools) ? (tools as ChatToolPayload[]) : null,
        usage: usage ?? message.metadata?.usage ?? null,
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
   * Cursor-paginated read of a topic's mainline conversation, aligned to round
   * boundaries (a mainline `user` message starts a round). Built for callers that
   * only DISPLAY history and never resend it to the model — server-runtime
   * (gateway) and local hetero agents — where eagerly loading the whole transcript
   * is wasteful on long topics. Legacy client mode keeps using `query` (full
   * fetch) because it resends the entire session each turn.
   *
   * Initial load (`cursor` omitted) returns the newest `roundLimit` rounds, or
   * fewer if `countBudget` is reached first, but the current round is always
   * whole. Pass the returned `nextCursor` to load the previous rounds (scroll up).
   * Unlike offset paging, cursors land on round boundaries, so consecutive pages
   * are gap-free and never split a round.
   */
  queryTopicMessagesByCursor = async (
    {
      countBudget = DEFAULT_ROUND_COUNT_BUDGET,
      cursor,
      direction = 'backward',
      groupId,
      includeFileWorks,
      roundLimit = DEFAULT_ROUND_LIMIT,
      skipWorks,
      topicId,
    }: QueryTopicByCursorParams,
    options: {
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
      timing?: ModelTimingContext;
    } = {},
  ): Promise<TopicMessagesByCursorResult> => {
    // Same visitor gate as `query`: a creator's read of an agent-share visitor
    // topic fails closed, and a verified creator topic skips the per-row check.
    if ((await this.resolveTopicVisitorScope(topicId)) === 'visitor') {
      return { hasMore: false, messages: [], nextCursor: null };
    }

    // Mainline = this topic (and its chat group, if any), not in a thread. Like
    // the standard `query`, a concrete topic is the conversation boundary: it is
    // NOT narrowed by agent/session, because a topic may legitimately hold rows
    // from several agents (e.g. `callAgent` / delegated replies).
    const mainlineWhere = and(
      this.matchTopic(topicId),
      this.matchGroup(groupId),
      this.matchThread(undefined),
    );

    const { groupNodeWindow, hasMore, nextCursor, where } = await resolveCursorPageWindow(this.db, {
      countBudget,
      cursor,
      direction,
      mainlineWhere,
      roundLimit,
      scopeWhere: this.ownership(),
    });

    const messages = await this.page.queryWithWhere({
      allowShareVisitor: true,
      current: 0,
      includeFileWorks,
      pageSize: CURSOR_PAGE_CEILING,
      postProcessUrl: options.postProcessUrl,
      skipWorks,
      timing: options.timing,
      topicId,
      where,
      // Only assemble group nodes within this page's window (not the whole topic),
      // so scroll-up pages don't repeat groups or eagerly load compressed history.
      groupNodeWindow,
    });

    return { hasMore, messages, nextCursor };
  };
}
