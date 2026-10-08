import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type ComposioServer, type ComposioTool } from './types';

export interface ComposioStoreState {
  /** Replica view of app tool catalogs, one entry per `appSlug`. */
  composioAppToolsMap: Record<string, ComposioTool[]>;
  /** Replica bookkeeping of `composioAppToolsMap`. */
  composioAppToolsReplica: ReplicaState<ComposioTool[]>;
  /** In-flight tool calls, keyed `identifier:toolSlug` (local UI state; never persisted). */
  composioExecutingToolIds: Set<string>;
  /** The user's Composio connections — the view of the `composioServers` replica. */
  composioServers: ComposioServer[];
  /** Replica bookkeeping of `composioServers`. */
  composioServersReplica: ReplicaState<ComposioServer[]>;
  /**
   * Whether the connections view has been filled (from storage or the server).
   * Gates the replica lens: an un-loaded list must read `undefined`, otherwise
   * hydration would treat the empty default as a real value.
   */
  isComposioServersInit: boolean;
  /** In-flight connection writes, by `identifier` (local UI state; never persisted). */
  loadingComposioServerIds: Set<string>;
}

export const initialComposioStoreState: ComposioStoreState = {
  composioExecutingToolIds: new Set(),
  composioAppToolsMap: {},
  composioAppToolsReplica: createReplicaState(),
  composioServers: [],
  composioServersReplica: createReplicaState(),
  isComposioServersInit: false,
  loadingComposioServerIds: new Set(),
};
