import type {
  HomeAgentRecord,
  HomeBriefRecord,
  HomeChatGroupRecord,
  HomeEntityIndex,
  HomeEntitySnapshot,
  HomeIndexKey,
  HomeSnapshotKey,
  HomeTaskRecord,
  HomeTopicRecord,
} from '@lobechat/types';

export type EntityScopeHydrationStatus = 'hydrating' | 'ready' | 'uninitialized';

export interface HomeEntityTables {
  agent: Record<string, HomeAgentRecord>;
  brief: Record<string, HomeBriefRecord>;
  chatGroup: Record<string, HomeChatGroupRecord>;
  task: Record<string, HomeTaskRecord>;
  topic: Record<string, HomeTopicRecord>;
}

export interface HomeEntityScopeState {
  entities: HomeEntityTables;
  hydrationStatus: EntityScopeHydrationStatus;
  indexes: Partial<Record<HomeIndexKey, HomeEntityIndex>>;
  snapshots: Partial<Record<HomeSnapshotKey, HomeEntitySnapshot>>;
}

export interface EntityStoreState {
  scopes: Record<string, HomeEntityScopeState>;
}

export const createEmptyEntityScope = (
  hydrationStatus: EntityScopeHydrationStatus = 'uninitialized',
): HomeEntityScopeState => ({
  entities: {
    agent: {},
    brief: {},
    chatGroup: {},
    task: {},
    topic: {},
  },
  hydrationStatus,
  indexes: {},
  snapshots: {},
});

export const initialState: EntityStoreState = {
  scopes: {},
};
