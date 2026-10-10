import type { CategoryItem } from '@lobehub/market-sdk';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  DiscoverPluginDetail,
  IdentifiersResponse,
  PluginListResponse,
} from '@/types/discover';

/**
 * Replica views of the plugin market reads, each beside its bookkeeping slot.
 * The views are plain records keyed by the entry key of the matching resource
 * (`projection.ts`); components read them through `pluginSelectors`, never
 * through the fetch hook.
 */
export interface PluginSliceState {
  /** Category counts per query (`pluginCategoriesQueryKey`). */
  pluginCategoriesMap: Record<string, CategoryItem[]>;
  /** Replica bookkeeping of `pluginCategoriesMap`. */
  pluginCategoriesReplica: ReplicaState<CategoryItem[]>;
  /** Plugin detail per identifier (`pluginDetailQueryKey`). */
  pluginDetailMap: Record<string, DiscoverPluginDetail>;
  /** Replica bookkeeping of `pluginDetailMap`. */
  pluginDetailReplica: ReplicaState<DiscoverPluginDetail>;
  /** Identifier index (`pluginIdentifiersQueryKey`). */
  pluginIdentifiersMap: Record<string, IdentifiersResponse>;
  /** Replica bookkeeping of `pluginIdentifiersMap`. */
  pluginIdentifiersReplica: ReplicaState<IdentifiersResponse>;
  /** Plugin list per query (`pluginListQueryKey`). */
  pluginListMap: Record<string, PluginListResponse>;
  /** Replica bookkeeping of `pluginListMap`. */
  pluginListReplica: ReplicaState<PluginListResponse>;
}

export const initialPluginSliceState: PluginSliceState = {
  pluginCategoriesMap: {},
  pluginCategoriesReplica: createReplicaState(),
  pluginDetailMap: {},
  pluginDetailReplica: createReplicaState(),
  pluginIdentifiersMap: {},
  pluginIdentifiersReplica: createReplicaState(),
  pluginListMap: {},
  pluginListReplica: createReplicaState(),
};
