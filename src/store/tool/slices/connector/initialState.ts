import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { AgentBoundConnector, ConnectorWithTools } from './types';

export interface ConnectorState {
  /**
   * All agent-owned connectors across every agent in the current scope, for the
   * unified connector-settings page. Distinct from `agentConnectors`
   * (keyed per-agent, includes mounted rows) — this is the flat aggregate.
   * Replica view of `agentBoundConnectorsReplica`.
   */
  agentBoundConnectors: AgentBoundConnector[];
  /** Replica bookkeeping for `agentBoundConnectors`. */
  agentBoundConnectorsReplica: ReplicaState<AgentBoundConnector[]>;
  /** Agent-scoped connectors (owned + mounted), keyed by agentId. Replica view. */
  agentConnectors: Record<string, ConnectorWithTools[]>;
  /**
   * Per-agent init gate of `agentConnectors`: a bucket only counts as loaded
   * once it has been hydrated or filled, so an empty default never blocks the
   * first hydrate.
   */
  agentConnectorsInit: Record<string, boolean>;
  /** Replica bookkeeping for `agentConnectors`. */
  agentConnectorsReplica: ReplicaState<ConnectorWithTools[]>;
  connectorCreating: boolean;
  /**
   * Connectors of the active scope. Replica view of `connectorsReplica`, read
   * by the tool picker, the settings pages and the agent profile.
   */
  connectors: ConnectorWithTools[];
  /** Replica bookkeeping for `connectors`. */
  connectorsReplica: ReplicaState<ConnectorWithTools[]>;
  connectorSyncing: Record<string, boolean>;
  /**
   * Whether the agent-bound aggregate has been filled (from storage or the
   * server). Gates the replica lens the same way `isConnectorsInit` does.
   */
  isAgentBoundInit: boolean;
  /**
   * Whether the connector list has been filled (from storage or the server).
   * Gates the replica lens: an un-loaded list must read `undefined`, otherwise
   * hydration would treat the empty default as a real value.
   */
  isConnectorsInit: boolean;
}

export const initialConnectorState: ConnectorState = {
  agentBoundConnectors: [],
  agentBoundConnectorsReplica: createReplicaState(),
  agentConnectors: {},
  agentConnectorsInit: {},
  agentConnectorsReplica: createReplicaState(),
  connectorCreating: false,
  connectors: [],
  connectorsReplica: createReplicaState(),
  connectorSyncing: {},
  isAgentBoundInit: false,
  isConnectorsInit: false,
};
