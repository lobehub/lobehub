import type {
  AgentProjection,
  BriefProjection,
  ChatGroupProjection,
  ProjectionIndexMap,
  ProjectionSnapshotMap,
  TaskProjection,
  TopicProjection,
} from '@lobechat/types';

export type ProjectionScopeHydrationStatus = 'hydrating' | 'ready' | 'uninitialized';

export interface ProjectionRecordTables {
  agent: Record<string, AgentProjection>;
  brief: Record<string, BriefProjection>;
  chatGroup: Record<string, ChatGroupProjection>;
  task: Record<string, TaskProjection>;
  topic: Record<string, TopicProjection>;
}

export interface ProjectionScopeState {
  hydrationStatus: ProjectionScopeHydrationStatus;
  indexes: Partial<ProjectionIndexMap>;
  records: ProjectionRecordTables;
  snapshots: Partial<ProjectionSnapshotMap>;
}

export interface ProjectionStoreState {
  scopes: Record<string, ProjectionScopeState>;
}

export const createEmptyProjectionScope = (
  hydrationStatus: ProjectionScopeHydrationStatus = 'uninitialized',
): ProjectionScopeState => ({
  records: {
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

export const initialState: ProjectionStoreState = {
  scopes: {},
};
