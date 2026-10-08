import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

import type { AgentBoundConnector, ConnectorWithTools } from './types';

/**
 * The connector lists are not paged, so each resource holds one entry per
 * scope and every sync shares these params.
 */
export const CONNECTOR_LIST_KEY = 'all';

/**
 * Connectors of the active scope (`connectors`), read by the tool picker, the
 * connector settings page and the agent profile. A local-first replica paints
 * the persisted list on the first frame and lets the network confirm it.
 */
export const connectorsResource = defineReplica<
  Record<string, never>,
  ConnectorWithTools[],
  ConnectorWithTools[]
>({
  key: () => CONNECTOR_LIST_KEY,
  name: 'connectors',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Every agent-owned connector across agents (`agentBoundConnectors`), for the
 * unified connector-settings page. Kept as its own resource because it is a
 * heavier, server-enriched projection (`listAgentBound`) than the base list.
 */
export const agentBoundConnectorsResource = defineReplica<
  Record<string, never>,
  AgentBoundConnector[],
  AgentBoundConnector[]
>({
  key: () => CONNECTOR_LIST_KEY,
  name: 'agentBoundConnectors',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One agent's own connectors — owned plus mounted (`agentConnectors[agentId]`),
 * for the Agent Tools tab and the profile editor.
 */
export const agentConnectorsResource = defineReplica<{ agentId: string }, ConnectorWithTools[]>({
  key: ({ agentId }) => agentId,
  name: 'agentConnectors',
  storage: 'indexedDB',
  version: 1,
});

/** Connectors are addressed by `id` across the tool store. */
export const connectorsEntity: ReplicaEntityAdapter<ConnectorWithTools[], ConnectorWithTools> =
  arrayEntity<ConnectorWithTools>((connector) => connector.id);

export const agentBoundConnectorsEntity: ReplicaEntityAdapter<
  AgentBoundConnector[],
  AgentBoundConnector
> = arrayEntity<AgentBoundConnector>((connector) => connector.id);
