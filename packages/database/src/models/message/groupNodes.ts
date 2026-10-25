import { parse } from '@lobechat/conversation-flow';
import type { UIChatMessage } from '@lobechat/types';
import { MessageGroupType } from '@lobechat/types';
import { eq, inArray, sql } from 'drizzle-orm';

import type { MessageGroupItem } from '../../schemas';
import { messagePlugins, messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * Most members a `compressedGroup` node hydrates into `compressedMessages`.
 * A long-running topic compresses thousands of messages into one group, and
 * every read of the topic used to load each of them in full and run them
 * through `parse()` — one such read of a 5k-member group held a server
 * instance for ~2 minutes and stalled every request sharing it. The newest
 * members are kept (aligned to a round start); pinned members load regardless,
 * and omitted members that carry runtime state keep their plugin state as
 * flat `tool` rows.
 */
export const MAX_COMPRESSED_GROUP_MEMBERS = 300;

/**
 * Tool calls whose `pluginState` later runs read back from history to restore
 * activated skills and tools (see `extractActivatedSkillsFromMessages` /
 * `extractActivatedToolIdsFromMessages` in `@lobechat/agent-runtime`): the
 * activation APIs of these identifiers only — their command / script /
 * resource calls carry no restored state and can be large. Literal copies —
 * the tool packages are not database dependencies.
 */
const STATE_BEARING_TOOL_IDENTIFIERS = new Set(['lobe-activator', 'lobe-skills']);
const STATE_BEARING_API_NAMES = new Set(['activateSkill', 'activateTools']);

/**
 * Columns the light member select adds (it left-joins `message_plugins`), so
 * an omitted member that carries runtime state is known without loading it.
 */
export const compressedStateMarkerColumns = {
  // Key test, not `IS NOT NULL` on an extracted value — see jsonbNullTest.test.ts.
  carriesTodos: sql<boolean>`coalesce(jsonb_exists(${messagePlugins.state}, 'todos'), false)`,
  pluginApiName: messagePlugins.apiName,
  pluginIdentifier: messagePlugins.identifier,
};

/** The light per-member row read before any member is hydrated. */
export interface MessageGroupMemberRecord {
  carriesTodos: boolean | null;
  favorite: boolean | null;
  id: string;
  messageGroupId: string | null;
  pluginApiName: string | null;
  pluginIdentifier: string | null;
  role: string | null;
}

const carriesRuntimeState = (record: MessageGroupMemberRecord) =>
  record.role === 'tool' &&
  (record.carriesTodos === true ||
    (!!record.pluginIdentifier &&
      STATE_BEARING_TOOL_IDENTIFIERS.has(record.pluginIdentifier) &&
      !!record.pluginApiName &&
      STATE_BEARING_API_NAMES.has(record.pluginApiName)));

type MessageGroupRow = Pick<
  MessageGroupItem,
  'content' | 'createdAt' | 'id' | 'metadata' | 'topicId' | 'type' | 'updatedAt'
>;

/**
 * Pick the members of one compression group to hydrate: the newest
 * {@link MAX_COMPRESSED_GROUP_MEMBERS}, trimmed forward to the first mainline
 * `user` message so the slice parses as one chain (same rule as the newest-page
 * trim in `MessageModel.queryWithWhere`). A slice with no user message is kept whole.
 */
export const selectCompressedGroupMembers = <T extends { role: string | null }>(
  members: T[],
  limit: number = MAX_COMPRESSED_GROUP_MEMBERS,
): T[] => {
  if (members.length <= limit) return members;

  const tail = members.slice(-limit);
  const firstRoundStart = tail.findIndex((member) => member.role === 'user');
  return firstRoundStart > 0 ? tail.slice(firstRoundStart) : tail;
};

export interface MessageGroupHydrationPlan {
  /** Members to hydrate per group: all of a compare group, the capped slice of a compression group. */
  hydratedByGroup: Map<string, MessageGroupMemberRecord[]>;
  /** Every id `queryByIds` must load: the hydrated members plus pinned compression members. */
  idsToHydrate: string[];
  /** All members per group, ascending. */
  recordsByGroup: Map<string, MessageGroupMemberRecord[]>;
  /** Omitted compression members that carry runtime state, per group, ascending. */
  stateByGroup: Map<string, MessageGroupMemberRecord[]>;
  /** Every id whose plugin state `loadCompressedStateRows` must load. */
  stateIds: string[];
}

export const planMessageGroupHydration = (
  groups: Pick<MessageGroupRow, 'id' | 'type'>[],
  records: MessageGroupMemberRecord[],
): MessageGroupHydrationPlan => {
  const recordsByGroup = new Map<string, MessageGroupMemberRecord[]>();
  for (const record of records) {
    if (!record.messageGroupId) continue;
    const groupRecords = recordsByGroup.get(record.messageGroupId) ?? [];
    groupRecords.push(record);
    recordsByGroup.set(record.messageGroupId, groupRecords);
  }

  const hydratedByGroup = new Map<string, MessageGroupMemberRecord[]>();
  const stateByGroup = new Map<string, MessageGroupMemberRecord[]>();
  const ids = new Set<string>();
  const stateIds: string[] = [];
  for (const group of groups) {
    const groupRecords = recordsByGroup.get(group.id) ?? [];
    const isCompression = group.type === MessageGroupType.Compression;
    const hydrated = isCompression ? selectCompressedGroupMembers(groupRecords) : groupRecords;
    hydratedByGroup.set(group.id, hydrated);
    for (const record of hydrated) ids.add(record.id);
    if (!isCompression) continue;

    for (const record of groupRecords) if (record.favorite) ids.add(record.id);
    const omitted = groupRecords.slice(0, groupRecords.length - hydrated.length);
    const stateRecords = omitted.filter(carriesRuntimeState);
    stateByGroup.set(group.id, stateRecords);
    for (const record of stateRecords) stateIds.push(record.id);
  }

  return { hydratedByGroup, idsToHydrate: [...ids], recordsByGroup, stateByGroup, stateIds };
};

export interface CompressedStateRow {
  apiName: string | null;
  createdAt: Date;
  id: string;
  identifier: string | null;
  state: unknown;
  type: string | null;
  updatedAt: Date;
}

/**
 * Plugin payload + state of the omitted state-bearing members — no message
 * content, which is what makes hydrating every member expensive. The ids come
 * from the caller's scoped member select.
 */
export const loadCompressedStateRows = async (
  db: LobeChatDatabase,
  ids: string[],
): Promise<Map<string, CompressedStateRow>> => {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      apiName: messagePlugins.apiName,
      createdAt: messages.createdAt,
      id: messagePlugins.id,
      identifier: messagePlugins.identifier,
      state: messagePlugins.state,
      type: messagePlugins.type,
      updatedAt: messages.updatedAt,
    })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(inArray(messagePlugins.id, ids));

  return new Map(rows.map((row) => [row.id, row]));
};

const toSnapshot = (m: UIChatMessage) => ({
  content: m.content,
  createdAt: m.createdAt,
  id: m.id,
  model: m.model,
  provider: m.provider,
  role: m.role,
});

/**
 * Build one MessageGroup node from its hydrated members:
 * - compressedGroup: `pinnedMessages` (favorite=true) and `compressedMessages`
 *   parsed through conversation-flow (e.g. into assistantGroup display nodes)
 * - compareGroup: `children` with basic info
 */
export const buildMessageGroupNode = (
  group: MessageGroupRow,
  plan: MessageGroupHydrationPlan,
  messageMap: Map<string, UIChatMessage>,
  stateRows: Map<string, CompressedStateRow> = new Map(),
): UIChatMessage => {
  const records = plan.recordsByGroup.get(group.id) ?? [];
  const hydrated = plan.hydratedByGroup.get(group.id) ?? [];
  const groupMsgs = hydrated
    .map((record) => messageMap.get(record.id))
    .filter(Boolean) as UIChatMessage[];

  if (group.type !== MessageGroupType.Compression) {
    return {
      children: groupMsgs.map(toSnapshot),
      createdAt: group.createdAt,
      id: group.id,
      role: 'compareGroup',
      topicId: group.topicId,
      updatedAt: group.updatedAt,
    } as unknown as UIChatMessage;
  }

  const pinnedMessages = records
    .filter((record) => record.favorite === true)
    .map((record) => messageMap.get(record.id))
    .filter(Boolean)
    .map((m) => toSnapshot(m!));
  // `hydrated` is a suffix of `records`, so the omitted members lead it.
  const compressedOmittedIds = records
    .slice(0, records.length - hydrated.length)
    .map((record) => record.id);
  // Omitted members that carry runtime state, as flat `tool` rows (plugin +
  // state, no content) ahead of the hydrated slice. Every released client's
  // selectors already restore state from flat tool rows in `compressedMessages`,
  // and the compressed history view does not render `tool` rows.
  const stateMessages = (plan.stateByGroup.get(group.id) ?? [])
    .map((record) => stateRows.get(record.id))
    .filter(Boolean)
    .map((row) => ({
      content: '',
      createdAt: row!.createdAt,
      id: row!.id,
      plugin: {
        apiName: row!.apiName,
        identifier: row!.identifier,
        type: row!.type,
      },
      pluginState: row!.state,
      role: 'tool',
      updatedAt: row!.updatedAt,
    })) as unknown as UIChatMessage[];

  return {
    compressedMessages: [...stateMessages, ...parse(groupMsgs).flatList],
    ...(compressedOmittedIds.length > 0 && {
      compressedOmittedIds,
      compressedTurnCount:
        records.filter((record) => record.role === 'user').length || records.length,
    }),
    content: group.content,
    createdAt: group.createdAt,
    id: group.id,
    // The group's real last member, for parent-child linking in conversation-flow.
    lastMessageId: records.at(-1)?.id,
    metadata: group.metadata,
    pinnedMessages,
    role: 'compressedGroup',
    topicId: group.topicId,
    updatedAt: group.updatedAt,
  } as unknown as UIChatMessage;
};
