import type { AgentGroupDetail } from '@lobechat/types';

import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import {
  arrayEntity,
  defineReplica,
  type ReplicaEntityAdapter,
  singleEntity,
} from '@/libs/replica';

/** The group list is one entry per scope, so every sync shares these params. */
export const AGENT_GROUP_LIST_KEY = 'all';

export interface AgentGroupDetailParams {
  groupId: string;
}

/**
 * Group metadata rows of the active scope (`groups`), from `group.getGroups`.
 * Seeds `groupMap` with the groups whose detail has not been fetched yet, so
 * `getGroupById` / `getGroupMeta` can resolve a group the viewer has access to
 * before its detail page mounts.
 */
export const agentGroupListResource = defineReplica<Record<string, never>, ChatGroupItem[]>({
  key: () => AGENT_GROUP_LIST_KEY,
  name: 'agentGroupList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One group's detail, keyed by group id (`groupMap[groupId]`): the roster, the
 * config and the supervisor. The fetch resolves `null` when the group is gone
 * or the viewer lost access — a settled 404, not a retryable error — which the
 * sync hook turns into `groupNotFoundMap`.
 */
export const agentGroupDetailResource = defineReplica<
  AgentGroupDetailParams,
  AgentGroupDetail,
  AgentGroupDetail | null
>({
  key: ({ groupId }) => groupId,
  name: 'agentGroupDetail',
  storage: 'indexedDB',
  version: 1,
});

/** A group is addressed by `id` in both the list row and the detail map. */
export const agentGroupsEntity: ReplicaEntityAdapter<ChatGroupItem[], ChatGroupItem> =
  arrayEntity<ChatGroupItem>((group) => group.id);

/**
 * The same group also lives in `groupMap[groupId]` as an `AgentGroupDetail`.
 * A list row carries no roster, so spreading one onto a loaded detail keeps
 * `agents` (and any other detail-only field) intact.
 */
export const agentGroupDetailEntity = singleEntity<AgentGroupDetail, ChatGroupItem>(
  (group) => group.id,
  {
    // `AgentGroupDetail` is the slimmer shared type while the store rows are the
    // database `ChatGroupItem` (which also carries the soft-delete columns), so
    // the detail is handed to the entity mapper as the row shape it came from.
    get: (detail) => detail as unknown as ChatGroupItem,
    set: (detail, group) => ({ ...detail, ...group }),
  },
);
