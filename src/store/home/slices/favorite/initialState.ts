import type { FavoriteItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface FavoriteState {
  /** Favorites of the current scope, the view of the `favoriteList` replica. */
  favoriteListMap: Record<string, FavoriteItem[]>;
  favoriteListReplica: ReplicaState<FavoriteItem[]>;
}

export const initialFavoriteState: FavoriteState = {
  favoriteListMap: {},
  favoriteListReplica: createReplicaState(),
};
