import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { DiscoverMcpDetail, McpListResponse } from '@/types/discover';

/**
 * Replica views of the MCP market reads, each beside its bookkeeping slot.
 * The views are plain records keyed by the entry key of the matching resource
 * (`projection.ts`); components read them through `mcpSelectors`, never
 * through the fetch hook.
 */
export interface MCPSliceState {
  /** Category counts per query (`mcpCategoriesQueryKey`). */
  mcpCategoriesMap: Record<string, CategoryItem[]>;
  /** Replica bookkeeping of `mcpCategoriesMap`. */
  mcpCategoriesReplica: ReplicaState<CategoryItem[]>;
  /** MCP detail per identifier (`mcpDetailQueryKey`). */
  mcpDetailMap: Record<string, DiscoverMcpDetail>;
  /** Replica bookkeeping of `mcpDetailMap`. */
  mcpDetailReplica: ReplicaState<DiscoverMcpDetail>;
  /** MCP list per query (`mcpListQueryKey`). */
  mcpListMap: Record<string, McpListResponse>;
  /** Replica bookkeeping of `mcpListMap`. */
  mcpListReplica: ReplicaState<McpListResponse>;
}

export const initialMCPSliceState: MCPSliceState = {
  mcpCategoriesMap: {},
  mcpCategoriesReplica: createReplicaState(),
  mcpDetailMap: {},
  mcpDetailReplica: createReplicaState(),
  mcpListMap: {},
  mcpListReplica: createReplicaState(),
};
