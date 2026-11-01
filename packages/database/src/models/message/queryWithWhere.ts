import type {
  ChatAudioItem,
  ChatFileItem,
  ChatVideoItem,
  ModelUsage,
  UIChatMessage,
  WorkSummaryItem,
} from '@lobechat/types';
import {
  getDurationMs,
  logTimingSink as logTiming,
  runTimedSinkStage as runTimedStage,
} from '@lobechat/utils';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';

import { messagePlugins, messages, messageTranslates, messageTTS, users } from '../../schemas';
import { createChatImageItem, materializeChatAudioItem } from './attachments';
import type { MessageByIdsQueries } from './queryByIds';
import type { MessageRelationQueries } from './relations';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';
import type { MessageGroupNodeWindow, ModelTimingContext, QueryMessagesOptions } from './types';

export class MessagePageQueries extends MessageScope {
  private readonly relations: MessageRelationQueries;
  private readonly byIds: MessageByIdsQueries;

  constructor(
    args: MessageScopeArgs,
    deps: { relations: MessageRelationQueries; byIds: MessageByIdsQueries },
  ) {
    super(...args);
    this.relations = deps.relations;
    this.byIds = deps.byIds;
  }

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
      before,
      current = 0,
      includeFileWorks,
      pageSize = 1000,
      postProcessUrl,
      skipWorks,
      topicId,
      timing,
      allowShareVisitor,
      workAccessScope,
      groupNodeWindow,
    } = options;
    const totalStartedAt = Date.now();
    const offset = current * pageSize;
    // See {@link QueryMessagesOptions.allowShareVisitor}. Combined with the
    // instance's `includeShareVisitor` so either widens the scope.
    const scope =
      allowShareVisitor || this.includeShareVisitor ? this.workspaceScope() : this.ownership();

    // Round-cursor paging: only rows strictly older than the `(createdAt, id)`
    // tuple. The id tie-break mirrors the sort order below, so rows sharing a
    // createdAt with the cursor are neither skipped nor duplicated.
    const beforeCondition = before
      ? or(
          lt(messages.createdAt, before.createdAt),
          and(eq(messages.createdAt, before.createdAt), lt(messages.id, before.id)),
        )
      : undefined;

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
              // `id` MUST be the first selected field: drizzle decides whether a
              // left-joined nested selection is null from its first column, so
              // leading with a nullable column (avatar) collapsed every
              // avatar-less sender to `sender: null`.
              id: users.id,
              avatar: users.avatar,
              fullName: users.fullName,
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
              scope,
              // Filter out messages that belong to MessageGroups
              isNull(messages.messageGroupId),
              where,
              beforeCondition,
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
          // unaffected; only *which* rows are fetched changed. See.
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
    // Scope: this serves the single "most recent page" load (`current === 0`)
    // and the round-cursor `before` pages that walk older history — the only
    // shapes the chat read path requests; `current`/`pageSize` offset paging is
    // dead code here (the very premise of). The trim is deliberately NOT
    // offset-exact: rows dropped from one page reappear at the TOP of the next
    // `before` page (its cursor is the trimmed page's oldest kept row), so the
    // round-cursor walk loses nothing by construction.
    if (topicId && (current === 0 || before) && result.length >= pageSize) {
      const firstRoundStart = result.findIndex((message) => message.role === 'user');
      if (firstRoundStart > 0) result.splice(0, firstRoundStart);
    }

    const messageIds = result.map((message) => message.id as string);

    const messageGroupNodesPromise = this.queryMessageGroupNodesForPage({
      allowShareVisitor: allowShareVisitor || this.includeShareVisitor,
      current,
      hasBeforeCursor: !!before,
      postProcessUrl,
      result,
      timing,
      topicId,
      window: groupNodeWindow,
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
      this.relations.queryMessageFileRelations(messageIds, postProcessUrl, timing),
      this.relations.queryMessageChunkRelations(messageIds, timing),
      this.relations.queryMessageQueryRelations(messageIds, timing),
      this.relations.queryMessageThreadRelations(taskMessageIds, timing),
      skipWorks
        ? ({} as Record<string, WorkSummaryItem[]>)
        : this.relations.queryMessageWorkSummaries(
            result,
            includeFileWorks,
            timing,
            workAccessScope,
          ),
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

    const threadMap = this.relations.createThreadMap(threadData);

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
                        content: documentsMap[id]?.content,
                        originalCharCount: documentsMap[id]?.originalCharCount,
                        fileType: fileType!,
                        id,
                        name,
                        size: size!,
                        url,
                      },
                ),
              imageList: imageList
                .filter((relation) => relation.messageId === item.id)
                .map(({ fileType, id, metadata, name, url }) =>
                  createChatImageItem({ fileType, id, metadata, name: name!, url }),
                ),

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
                .map<ChatAudioItem>(materializeChatAudioItem),
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
    allowShareVisitor,
    current,
    hasBeforeCursor,
    postProcessUrl,
    result,
    timing,
    topicId,
    window,
  }: {
    /**
     * Effective visitor gate resolved by the caller (per-call
     * `allowShareVisitor` OR the instance's `includeShareVisitor`). Threaded
     * through so the underlying `messageGroups` where-clause fails closed on
     * a creator's default read of a visitor topic — otherwise a bare
     * workspace/topicId filter would still surface the group's synthetic
     * `compressedGroup`/`compareGroup` nodes (with content summaries) even
     * though the row query returned nothing.
     */
    allowShareVisitor?: boolean;
    current: number;
    /**
     * The page was fetched with a round-cursor (`before`): scope group nodes to
     * the page's time window instead of the whole topic — page 0 already
     * returned every group node, so an unwindowed fetch here would only
     * duplicate them.
     */
    hasBeforeCursor?: boolean;
    postProcessUrl?: (
      path: string | null,
      file: { fileType: string; id?: string | null },
    ) => Promise<string>;
    result: { createdAt: Date }[];
    timing?: ModelTimingContext;
    topicId?: string;
    /** Explicit group window (cursor pagination); overrides the row-derived one. */
    window?: MessageGroupNodeWindow;
  }): Promise<UIChatMessage[]> => {
    if (!topicId) return [];

    if (window) {
      return runTimedStage(
        timing,
        'db.message.queryWithWhere.messageGroups',
        () =>
          this.byIds.queryMessageGroupNodes(topicId, undefined, postProcessUrl, timing, {
            allowShareVisitor,
            window,
          }),
        { current, hasMessages: result.length > 0, topicId },
      );
    }

    if (result.length === 0) {
      if (current !== 0 || hasBeforeCursor) return [];

      return runTimedStage(
        timing,
        'db.message.queryWithWhere.messageGroups',
        () =>
          this.byIds.queryMessageGroupNodes(topicId, undefined, postProcessUrl, timing, {
            allowShareVisitor,
          }),
        { current, hasMessages: false, topicId },
      );
    }

    if (current === 0 && !hasBeforeCursor) {
      return runTimedStage(
        timing,
        'db.message.queryWithWhere.messageGroups',
        () =>
          this.byIds.queryMessageGroupNodes(topicId, undefined, postProcessUrl, timing, {
            allowShareVisitor,
          }),
        { current, hasMessages: true, topicId },
      );
    }

    const firstMessageTime = result[0].createdAt;
    const lastMessageTime = result.at(-1)!.createdAt;

    return runTimedStage(
      timing,
      'db.message.queryWithWhere.messageGroups',
      () =>
        this.byIds.queryMessageGroupNodes(
          topicId,
          {
            endTime: lastMessageTime,
            startTime: firstMessageTime,
          },
          postProcessUrl,
          timing,
          { allowShareVisitor },
        ),
      { current, hasMessages: true, topicId },
    );
  };
}
