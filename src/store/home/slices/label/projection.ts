import type { AgentLabelListItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/**
 * The label registry is one entry per cache scope. Labels are
 * workspace-shared, or personal outside a workspace; the registries are
 * disjoint, and the replica scope (`${userId}:${workspaceId}`) is what keeps a
 * switch from serving the previous workspace's labels — a shared key would let
 * a foreign label id be applied to an agent here, which is a destructive write.
 */
export const AGENT_LABELS_KEY = 'registry';

/**
 * Agent label registry for the current scope. Includes archived labels —
 * consumers filter as needed. Read by the sidebar label picker and the
 * workspace labels page; the persisted copy keeps the picker populated instead
 * of flashing empty while the network answers.
 */
export const agentLabelsResource = defineReplica<Record<string, never>, AgentLabelListItem[]>({
  key: () => AGENT_LABELS_KEY,
  name: 'agentLabels',
  storage: 'indexedDB',
  version: 1,
});
