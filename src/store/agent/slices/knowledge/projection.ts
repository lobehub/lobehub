import { type KnowledgeItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/**
 * Visibility surface of the agent-knowledge picker. `undefined` is the
 * unfiltered surface used in personal scope (see `resolvePickerScope`).
 */
export type AgentKnowledgeVisibility = 'private' | 'public';

export interface AgentKnowledgeListParams {
  agentId: string;
  visibility?: AgentKnowledgeVisibility;
}

/**
 * Entry identity of one knowledge surface: `<agentId>` (unfiltered) or
 * `<agentId>:<visibility>`. Agent ids never contain a colon, so the two never
 * collide. The picker keys its cache per visibility so switching tab after a
 * mutation never shows the other tab's stale rows.
 */
export const agentKnowledgeListKey = ({ agentId, visibility }: AgentKnowledgeListParams): string =>
  visibility ? `${agentId}:${visibility}` : agentId;

/**
 * Files + knowledge bases attached to one agent, one local-first entry per
 * visibility surface (`agentKnowledgeMap[<agentId>[:<visibility>]]`).
 *
 * Hydrates from IndexedDB, revalidates over the network, and is the only writer
 * of the view: read it through `agentKnowledgeSelectors`, the sync hook only
 * orchestrates fetching. `entity` lets a toggle/removal fan out to every loaded
 * surface of the same item.
 */
export const agentKnowledgeListResource = defineReplica<
  AgentKnowledgeListParams,
  KnowledgeItem[],
  KnowledgeItem[]
>({
  key: agentKnowledgeListKey,
  name: 'agentKnowledgeList',
  storage: 'indexedDB',
  version: 1,
});
