import type {
  ChatAudioItem,
  ChatFileItem,
  ChatVideoItem,
  ModelUsage,
  ThreadStatus,
  UIChatMessage,
} from '@lobechat/types';
import { logTimingSink as logTiming, runTimedSinkStage as runTimedStage } from '@lobechat/utils';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import pMap from 'p-map';

import {
  documents,
  files,
  type MessageGroupItem,
  messageGroups,
  messagePlugins,
  messageQueries,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
  threads,
  users,
} from '../../schemas';
import { notFileBackedPlaceholder } from '../../utils/fileBackedPlaceholder';
import { notShareVisitorTopicRef } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { FileDocumentsMap } from './attachments';
import {
  createChatImageItem,
  FILE_URL_POST_PROCESS_CONCURRENCY,
  fileDocumentColumns,
  fileDocumentsOrder,
  materializeChatAudioItem,
  toFileDocumentsMap,
} from './attachments';
import {
  buildMessageGroupNode,
  compressedStateMarkerColumns,
  loadCompressedStateRows,
  planMessageGroupHydration,
} from './groupNodes';
import type { MessageRelationQueries } from './relations';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';
import type { MessageGroupNodeWindow, ModelTimingContext } from './types';

export class MessageByIdsQueries extends MessageScope {
  private readonly relations: MessageRelationQueries;

  constructor(args: MessageScopeArgs, deps: { relations: MessageRelationQueries }) {
    super(...args);
    this.relations = deps.relations;
  }

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
      /**
       * Opt IN to agent-share visitor rows. Reserved for internal callers
       * (`queryMessageGroupNodes`) that already resolved and authorized the
       * parent topic via {@link resolveTopicVisitorScope}; every row shares
       * that topic's visitor/creator identity, so the per-row NOT EXISTS
       * predicate baked into `this.ownership()` is redundant once the topic
       * itself has been classified. External callers must leave this false.
       */
      allowShareVisitor?: boolean;
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
    } = {},
  ): Promise<UIChatMessage[]> => {
    if (messageIds.length === 0) return [];

    const { postProcessUrl } = options;
    const scope =
      options.allowShareVisitor || this.includeShareVisitor
        ? this.workspaceScope()
        : this.ownership();

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

        sender: {
          // `id` MUST be the first selected field — see queryWithWhere's sender
          // selection for why (drizzle left-join nested-object nullification).
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
      .where(and(scope, inArray(messages.id, messageIds)))
      .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .leftJoin(messageTranslates, eq(messageTranslates.id, messages.id))
      .leftJoin(messageTTS, eq(messageTTS.id, messages.id))
      .leftJoin(users, eq(users.id, messages.userId))
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
          metadata: files.metadata,
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
      this.relations.queryMessageChunkRelations(messageIds),

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
    const relatedFileList = await pMap(
      rawRelatedFileList,
      async (file) => {
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
      },
      { concurrency: FILE_URL_POST_PROCESS_CONCURRENCY },
    );

    // Get associated document content. Exclude tombstoned files — their parsed
    // document content must not leak through the unguarded documents join.
    const fileIds = relatedFileList
      .filter((file) => file.name !== null)
      .map((file) => file.id)
      .filter(Boolean);

    let documentsMap: FileDocumentsMap = {};

    if (fileIds.length > 0) {
      const documentsList = await this.db
        .select(fileDocumentColumns)
        .from(documents)
        .where(and(inArray(documents.fileId, fileIds), notFileBackedPlaceholder()))
        .orderBy(...fileDocumentsOrder);

      documentsMap = toFileDocumentsMap(documentsList);
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
        const messageQuery = messageQueriesList.find((relation) => relation.messageId === item.id);
        return {
          ...item,
          // Same presence contract as queryWithWhere: collapse a null-id sender
          // (deleted account) to `null` so clients can rely on `sender?.id`.
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
              // Nulled by the visibility guard: the viewer lost access to the
              // referenced file. Emit a tombstone (id only) so the UI renders
              // a no-access placeholder.
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
          audioList: audioList
            .filter((relation) => relation.messageId === item.id)
            .map<ChatAudioItem>(materializeChatAudioItem),
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
  queryMessageGroupNodes = async (
    topicId: string,
    timeRange?: { endTime: Date; startTime: Date },
    postProcessUrl?: (
      path: string | null,
      file: { fileType: string; id?: string | null },
    ) => Promise<string>,
    timing?: ModelTimingContext,
    options: { allowShareVisitor?: boolean; window?: MessageGroupNodeWindow } = {},
  ): Promise<UIChatMessage[]> => {
    // Effective visitor gate — see `queryMessageGroupNodesForPage`. Absent
    // this predicate, a creator's default `query({ topicId })` on a visitor
    // topic returns no messages but still returns the group's synthetic
    // `compressedGroup` node (with its `content` summary) or `compareGroup`
    // node, leaking the visitor conversation shape.
    const includeVisitor = options.allowShareVisitor || this.includeShareVisitor;

    // 1. Query MessageGroups for this topic, optionally filtered by time range
    const whereConditions = [
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageGroups),
      eq(messageGroups.topicId, topicId),
      ...(includeVisitor ? [] : [notShareVisitorTopicRef(messageGroups.topicId)]),
    ];

    // Add time range filter if provided (for pagination)
    if (timeRange) {
      whereConditions.push(
        gte(messageGroups.createdAt, timeRange.startTime),
        lte(messageGroups.createdAt, timeRange.endTime),
      );
    }

    // Explicit half-open `[from, before)` window from cursor pagination, compared
    // against lossless microsecond strings so page boundaries stay exact.
    if (options.window?.from) {
      whereConditions.push(sql`${messageGroups.createdAt} >= ${options.window.from}::timestamptz`);
    }
    if (options.window?.before) {
      whereConditions.push(sql`${messageGroups.createdAt} < ${options.window.before}::timestamptz`);
    }

    const groups: MessageGroupItem[] = await runTimedStage(
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
            ...compressedStateMarkerColumns,
            role: messages.role,
          })
          .from(messages)
          .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
          .where(
            and(
              // The parent topic has already been classified by the caller
              // (via `resolveTopicVisitorScope`) or the model was constructed
              // as a share-runtime instance — either way, the per-row NOT
              // EXISTS predicate baked into `ownership()` is redundant for
              // messages that belong to a group inside a verified topic.
              includeVisitor ? this.workspaceScope() : this.ownership(),
              inArray(messages.messageGroupId, groupIds),
            ),
          )
          .orderBy(asc(messages.createdAt)),
      { groupCount: groupIds.length },
    );
    logTiming(timing, 'db.message.messageGroups.messages.select:rows', {
      rowCount: groupMessageRecords.length,
    });

    // A compression group only hydrates its newest members (see
    // `MAX_COMPRESSED_GROUP_MEMBERS`) plus the pinned ones.
    const plan = planMessageGroupHydration(groups, groupMessageRecords);

    // 3. Query full message data using queryByIds (reuses all transformation logic),
    // and only the plugin state of omitted members that carry runtime state
    const [fullMessages, stateRows] = await Promise.all([
      runTimedStage(
        timing,
        'db.message.messageGroups.queryByIds',
        () =>
          this.queryByIds(plan.idsToHydrate, { allowShareVisitor: includeVisitor, postProcessUrl }),
        { messageCount: plan.idsToHydrate.length, totalMemberCount: groupMessageRecords.length },
      ),
      loadCompressedStateRows(this.db, plan.stateIds),
    ]);

    // 4. Build MessageGroup nodes
    const messageMap = new Map(fullMessages.map((m) => [m.id, m]));
    return groups.map((group) => buildMessageGroupNode(group, plan, messageMap, stateRows));
  };
}
