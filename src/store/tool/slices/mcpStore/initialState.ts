import { type PluginItem } from '@lobehub/market-sdk';

import { createReplicaState, type ReplicaPagedData, type ReplicaState } from '@/libs/replica';
import { type McpConnectionType } from '@/types/discover';
import { type MCPInstallProgressMap } from '@/types/plugins';

export type PluginStoreListType = 'installed' | 'mcp';

/**
 * The MCP marketplace list view: the generic local-first paged data plus the
 * query descriptors it was fetched with, so the surface can tell whether the
 * painted page set still answers the request on screen. Paging bookkeeping
 * (`currentPage` / `hasMore` / `isLoadingMore`) comes from `ReplicaPagedData`.
 */
export interface MCPPluginListData extends ReplicaPagedData<PluginItem, number> {
  connectionType?: McpConnectionType;
  locale?: string;
  q?: string;
}

export interface MCPStoreState {
  listType: PluginStoreListType;
  mcpInstallAbortControllers: Record<string, AbortController>;
  mcpInstallProgress: MCPInstallProgressMap;
  /**
   * The MCP marketplace list of the active scope — the view of the
   * `mcpPluginList` replica. `undefined` until the persisted row hydrates or the
   * first network page lands, so an un-loaded list never reads as an empty one.
   */
  mcpPluginList?: MCPPluginListData;
  /** Replica bookkeeping for `mcpPluginList`. */
  mcpPluginListReplica: ReplicaState<MCPPluginListData>;
  mcpSearchKeywords?: string;
  // Test connection related state
  mcpTestAbortControllers: Record<string, AbortController>;
  mcpTestErrors: Record<string, string>;
  mcpTestLoading: Record<string, boolean>;
}

export const initialMCPStoreState: MCPStoreState = {
  listType: 'mcp',
  mcpInstallAbortControllers: {},
  mcpInstallProgress: {},
  // Absent until the persisted row hydrates or the first network page lands.
  mcpPluginList: undefined,
  mcpPluginListReplica: createReplicaState(),
  mcpSearchKeywords: undefined,
  // Test connection related state initialization
  mcpTestAbortControllers: {},
  mcpTestErrors: {},
  mcpTestLoading: {},
};
