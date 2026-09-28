import type { MessageMetadata } from '@lobechat/types';
import { getTableColumns, type SQL, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { MAX_TOOL_IDENTIFIER_LENGTH } from '@/utils/clampToolIdentifier';

import {
  messageChunks,
  messageGroups,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

export type IdPair = [sourceId: string, newId: string];

/**
 * JS counterpart of the `metadata` rewrite this module applies in SQL, for
 * duplication paths that build their rows in memory (`TopicModel.duplicate`).
 * Keep in sync with `metadataExpr` below.
 *
 * The row keeps its token/cost figures: they are facts about the generation
 * the transcript records, and the chat UI, subagent chips and the context
 * engine's token accounting all read them. Only the `copied` marker is added,
 * and usage REPORTS filter on it — see `notCopiedTranscript` in
 * `./copiedTranscript`. Marking, not erasing, is what keeps a copy honest without
 * degrading it.
 */
export const markCopiedMessageMetadata = (metadata: unknown): MessageMetadata => {
  const next: Record<string, unknown> =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  return { ...next, copied: true } as MessageMetadata;
};

/** Message child table carrying the denormalized ownership snapshot columns. */
export type ScopedMessageChildTable = PgTable & {
  userId: PgColumn;
  workspaceId: PgColumn;
};

/**
 * Copies `messages` and every message child table (`message_plugins`,
 * `message_translates`, `message_tts`, `messages_files`, `message_queries`,
 * `message_query_chunks`, `message_chunks`) entirely inside the database.
 * Child rows follow their parent message into the target scope, mirroring the
 * transfer path's `MESSAGE_CHILD_ANCHORS`; referenced blobs (`file_id`,
 * `chunk_id`, `embeddings_id`) are NOT duplicated — the copied association
 * keeps pointing at the existing row, exactly like a transferred one does.
 * Only the id remap tables travel over the wire — message bodies
 * (which can add up to hundreds of MB) never leave PostgreSQL, so the copy is
 * fast and its memory footprint is independent of the history size. A single
 * `INSERT ... SELECT` also checks self-referential FKs (`parentId`/`quotaId`)
 * at end of statement, so reference order needs no special handling.
 *
 * Must run inside a transaction: the id maps are `ON COMMIT DROP` temp tables.
 *
 * Aliases available to the `agentIdExpr` / `targetIdExpr` expressions:
 * - `_copy_msg_id_map` — message id remap (joined on `messages.id`)
 * - `_amap` — agent id remap, LEFT JOINed on `messages.agent_id` (only when
 *   `agentIdPairs` is provided)
 * - `_amap_target` — agent id remap, LEFT JOINed on `messages.target_id`
 *   (only when `agentIdPairs` is provided)
 */
export interface CopyMessagesInDatabaseParams {
  /** SQL expression producing the copied rows' `agent_id` */
  agentIdExpr: SQL;
  /** Remap for `messages.agent_id` (only the pairs; expressions decide usage) */
  agentIdPairs?: IdPair[];
  /** Ownership scope applied to each child-table copy (plugins, translates, TTS, file/RAG links) */
  childScope?: (table: ScopedMessageChildTable) => SQL | undefined;
  executor: Pick<LobeChatDatabase, 'execute'>;
  /** Value for the copied rows' `group_id` */
  groupId: null | string;
  /** Every message to copy; rows outside this map are untouched */
  messageIdPairs: IdPair[];
  /** SQL expression producing the copied rows' `target_id` */
  targetIdExpr: SQL;
  targetUserId: string;
  targetWorkspaceId: null | string;
  threadIdPairs: IdPair[];
  topicIdPairs: IdPair[];
}

const seedIdMapTable = async (
  executor: Pick<LobeChatDatabase, 'execute'>,
  tableName: string,
  pairs: IdPair[],
) => {
  const table = sql.raw(tableName);
  await executor.execute(sql`drop table if exists ${table}`);
  await executor.execute(
    sql`create temp table ${table} (source_id text primary key, new_id text not null) on commit drop`,
  );

  if (pairs.length === 0) return;

  // A single JSONB parameter carries the whole map — portable across drivers
  // (some do not encode JS arrays as PostgreSQL array literals).
  await executor.execute(
    sql`insert into ${table} (source_id, new_id)
        select pair ->> 0, pair ->> 1 from jsonb_array_elements(${JSON.stringify(pairs)}::jsonb) as pair`,
  );
};

/**
 * Deterministic per-message remap for tool-call ids: the same expression is
 * used for `messages.tools[].id` and `message_plugins.tool_call_id`, so a
 * message and its plugin rows stay linked without materializing a map.
 */
const remappedToolId = (newMessageIdExpr: SQL, sourceToolIdExpr: SQL) =>
  sql`'toolu_' || substr(md5(${newMessageIdExpr} || ${sourceToolIdExpr}), 1, 24)`;

const buildCopyColumns = (table: PgTable, overrides: Record<string, SQL | undefined>) => {
  const names: SQL[] = [];
  const exprs: SQL[] = [];

  for (const [tsName, column] of Object.entries(getTableColumns(table))) {
    names.push(sql`${sql.identifier(column.name)}`);
    exprs.push(overrides[tsName] ?? sql`${column}`);
  }

  return { exprs: sql.join(exprs, sql`, `), names: sql.join(names, sql`, `) };
};

export const copyMessagesInDatabase = async ({
  agentIdExpr,
  agentIdPairs,
  childScope,
  executor,
  groupId,
  messageIdPairs,
  targetIdExpr,
  targetUserId,
  targetWorkspaceId,
  threadIdPairs,
  topicIdPairs,
}: CopyMessagesInDatabaseParams) => {
  if (messageIdPairs.length === 0) return;

  await seedIdMapTable(executor, '_copy_msg_id_map', messageIdPairs);
  await seedIdMapTable(executor, '_copy_topic_id_map', topicIdPairs);
  await seedIdMapTable(executor, '_copy_thread_id_map', threadIdPairs);
  if (agentIdPairs) await seedIdMapTable(executor, '_copy_agent_id_map', agentIdPairs);

  const newMessageId = sql.raw('_copy_msg_id_map.new_id');

  // `message_groups` of the copied topics come along too — without them,
  // compression/parallel groups would flatten into ordinary mainline messages
  // on the copied side. The remap is deterministic (new topic id + source
  // group id), so `messages.message_group_id` can follow it without another
  // round-trip. `parent_message_id` references messages, which do not exist
  // yet at this point — it is NULLed here and fixed up after the messages
  // insert below.
  const groupScope = childScope?.(messageGroups);
  await executor.execute(sql`drop table if exists _copy_group_id_map`);
  await executor.execute(sql`
    create temp table _copy_group_id_map on commit drop as
    select ${messageGroups.id} as source_id,
           'mg_' || substr(md5(_tmap.new_id || ${messageGroups.id}), 1, 20) as new_id
    from ${messageGroups}
    join _copy_topic_id_map _tmap on _tmap.source_id = ${messageGroups.topicId}
    ${groupScope ? sql`where ${groupScope}` : sql``}
  `);

  const groupColumns = buildCopyColumns(messageGroups, {
    clientId: sql`null`,
    id: sql.raw('_copy_group_id_map.new_id'),
    parentGroupId: sql.raw('_pgmap.new_id'),
    parentMessageId: sql`null`,
    topicId: sql.raw('_tmap.new_id'),
    userId: sql`${targetUserId}`,
    workspaceId: sql`${targetWorkspaceId}`,
  });
  await executor.execute(sql`
    insert into ${messageGroups} (${groupColumns.names})
    select ${groupColumns.exprs}
    from ${messageGroups}
    join _copy_group_id_map on _copy_group_id_map.source_id = ${messageGroups.id}
    left join _copy_group_id_map _pgmap on _pgmap.source_id = ${messageGroups.parentGroupId}
    left join _copy_topic_id_map _tmap on _tmap.source_id = ${messageGroups.topicId}
  `);

  const toolsExpr = sql`case
    when jsonb_typeof(${messages.tools}) = 'array' then coalesce((
      select jsonb_agg(
        case
          when jsonb_typeof(_tool.elem) = 'object' and jsonb_typeof(_tool.elem -> 'id') = 'string'
            then jsonb_set(_tool.elem, '{id}', to_jsonb(${remappedToolId(newMessageId, sql`(_tool.elem ->> 'id')`)}))
          else _tool.elem
        end
        order by _tool.ord)
      from jsonb_array_elements(${messages.tools}) with ordinality as _tool(elem, ord)
    ), '[]'::jsonb)
    else ${messages.tools}
  end`;

  // A copy consumes no tokens, so it carries `metadata.copied` and usage
  // REPORTS filter on it. The figures themselves stay: they describe the
  // generation this transcript records, and erasing them would blank the
  // token/cost chips and push the context engine onto heuristic estimation.
  const metadataExpr = sql`case
    when jsonb_typeof(${messages.metadata}) = 'object'
      then jsonb_set(${messages.metadata}, '{copied}', 'true'::jsonb)
    else '{"copied": true}'::jsonb
  end`;

  const messageColumns = buildCopyColumns(messages, {
    agentId: agentIdExpr,
    clientId: sql`null`,
    groupId: sql`${groupId}`,
    id: newMessageId,
    messageGroupId: sql.raw('_gmap.new_id'),
    metadata: metadataExpr,
    parentId: sql.raw('_pmap.new_id'),
    quotaId: sql.raw('_qmap.new_id'),
    sessionId: sql`null`,
    targetId: targetIdExpr,
    threadId: sql.raw('_thmap.new_id'),
    tools: toolsExpr,
    topicId: sql.raw('_tmap.new_id'),
    userId: sql`${targetUserId}`,
    workspaceId: sql`${targetWorkspaceId}`,
  });

  await executor.execute(sql`
    insert into ${messages} (${messageColumns.names})
    select ${messageColumns.exprs}
    from ${messages}
    join _copy_msg_id_map on _copy_msg_id_map.source_id = ${messages.id}
    left join _copy_msg_id_map _pmap on _pmap.source_id = ${messages.parentId}
    left join _copy_msg_id_map _qmap on _qmap.source_id = ${messages.quotaId}
    left join _copy_topic_id_map _tmap on _tmap.source_id = ${messages.topicId}
    left join _copy_thread_id_map _thmap on _thmap.source_id = ${messages.threadId}
    left join _copy_group_id_map _gmap on _gmap.source_id = ${messages.messageGroupId}
    ${agentIdPairs ? sql`left join _copy_agent_id_map _amap on _amap.source_id = ${messages.agentId} left join _copy_agent_id_map _amap_target on _amap_target.source_id = ${messages.targetId}` : sql``}
  `);

  // Deferred `parent_message_id` fixup: both sides of the copy exist now.
  await executor.execute(sql`
    update ${messageGroups} _copied
    set parent_message_id = _mmap.new_id
    from ${messageGroups} _src
    join _copy_group_id_map _gmap on _gmap.source_id = _src.id
    join _copy_msg_id_map _mmap on _mmap.source_id = _src.parent_message_id
    where _copied.id = _gmap.new_id
  `);

  const copyChildRows = async (
    table: ScopedMessageChildTable,
    anchor: PgColumn,
    overrides: Record<string, SQL | undefined>,
  ) => {
    const scope = childScope?.(table);
    const columns = buildCopyColumns(table, {
      clientId: sql`null`,
      userId: sql`${targetUserId}`,
      workspaceId: sql`${targetWorkspaceId}`,
      ...overrides,
    });
    await executor.execute(sql`
      insert into ${table} (${columns.names})
      select ${columns.exprs}
      from ${table}
      join _copy_msg_id_map on _copy_msg_id_map.source_id = ${anchor}
      ${scope ? sql`where ${scope}` : sql``}
    `);
  };

  await copyChildRows(messagePlugins, messagePlugins.id, {
    apiName: sql`left(${messagePlugins.apiName}, ${MAX_TOOL_IDENTIFIER_LENGTH})`,
    id: newMessageId,
    identifier: sql`left(${messagePlugins.identifier}, ${MAX_TOOL_IDENTIFIER_LENGTH})`,
    toolCallId: sql`case
      when ${messagePlugins.toolCallId} is null then null
      else ${remappedToolId(newMessageId, sql`${messagePlugins.toolCallId}`)}
    end`,
  });

  // 1:1 satellites keyed by the message id.
  await copyChildRows(messageTranslates, messageTranslates.id, { id: newMessageId });
  await copyChildRows(messageTTS, messageTTS.id, { id: newMessageId });

  // Link tables keyed by `message_id`. `message_queries.id` needs its own
  // remap so `message_query_chunks.query_id` can follow it; the same
  // deterministic expression on both sides keeps them linked without a map.
  const remappedQueryId = (sourceQueryIdExpr: SQL) =>
    sql`(md5(${newMessageId} || ${sourceQueryIdExpr}))::uuid`;

  await copyChildRows(messagesFiles, messagesFiles.messageId, { messageId: newMessageId });
  await copyChildRows(messageQueries, messageQueries.messageId, {
    id: remappedQueryId(sql`${messageQueries.id}::text`),
    messageId: newMessageId,
  });
  await copyChildRows(messageQueryChunks, messageQueryChunks.messageId, {
    messageId: newMessageId,
    queryId: sql`case
      when ${messageQueryChunks.queryId} is null then null
      else ${remappedQueryId(sql`${messageQueryChunks.queryId}::text`)}
    end`,
  });
  await copyChildRows(messageChunks, messageChunks.messageId, { messageId: newMessageId });
};
