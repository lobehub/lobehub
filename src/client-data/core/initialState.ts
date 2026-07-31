import type {
  AgentEntityRecord,
  BriefEntityRecord,
  ChatGroupEntityRecord,
  ClientDataIndexMap,
  ClientDataSnapshotMap,
  TaskEntityRecord,
  TopicEntityRecord,
} from '@lobechat/types';

export type ClientDataScopeHydrationStatus = 'hydrating' | 'ready' | 'uninitialized';

export interface ClientDataEntityTables {
  agent: Record<string, AgentEntityRecord>;
  brief: Record<string, BriefEntityRecord>;
  chatGroup: Record<string, ChatGroupEntityRecord>;
  task: Record<string, TaskEntityRecord>;
  topic: Record<string, TopicEntityRecord>;
}

export interface ClientDataScopeState {
  entities: ClientDataEntityTables;
  hydrationStatus: ClientDataScopeHydrationStatus;
  indexes: Partial<ClientDataIndexMap>;
  snapshots: Partial<ClientDataSnapshotMap>;
}

export interface ClientDataStoreState {
  scopes: Record<string, ClientDataScopeState>;
}

export const createEmptyClientDataScope = (
  hydrationStatus: ClientDataScopeHydrationStatus = 'uninitialized',
): ClientDataScopeState => ({
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

export const initialState: ClientDataStoreState = {
  scopes: {},
};
