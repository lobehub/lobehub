import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type ActivitySliceState } from './slices/activity/initialState';
import { activityInitialState } from './slices/activity/initialState';
import { type AgentMemorySliceState } from './slices/agent';
import { agentMemoryInitialState } from './slices/agent';
import { type MemoryDetailDisplay } from './slices/base/projection';
import { type ContextSliceState } from './slices/context/initialState';
import { contextInitialState } from './slices/context/initialState';
import { type ExperienceSliceState } from './slices/experience/initialState';
import { experienceInitialState } from './slices/experience/initialState';
import { homeInitialState, type HomeSliceState } from './slices/home/initialState';
import { type IdentitySliceState } from './slices/identity';
import { identityInitialState } from './slices/identity';
import { type PreferenceSliceState } from './slices/preference/initialState';
import { preferenceInitialState } from './slices/preference/initialState';

export type { PersonaData } from './slices/home/projection';

export interface UserMemoryStoreState
  extends
    ActivitySliceState,
    AgentMemorySliceState,
    ContextSliceState,
    ExperienceSliceState,
    HomeSliceState,
    IdentitySliceState,
    PreferenceSliceState {
  activeParams?: RetrieveMemoryParams;
  activeParamsKey?: string;
  editingMemoryContent?: string;
  editingMemoryId?: string;
  editingMemoryLayer?: 'activity' | 'context' | 'experience' | 'identity' | 'preference';
  /**
   * Canonical replica view of one memory detail, keyed `${layer}:${id}`. The
   * engine owns every write; readers go through `useFetchMemoryDetail`.
   */
  memoryDetailMap: Record<string, MemoryDetailDisplay>;
  /** Local-first bookkeeping for `memoryDetailMap`. */
  memoryDetailReplica: ReplicaState<MemoryDetailDisplay>;
  memoryFetchedAtMap: Record<string, number>;
  memoryMap: Record<string, RetrieveMemoryResult>;
  /** Local-first bookkeeping for the retrieve result map (`memoryMap`). */
  memoryRetrieveReplica: ReplicaState<RetrieveMemoryResult>;
}

export const initialState: UserMemoryStoreState = {
  ...activityInitialState,
  ...agentMemoryInitialState,
  ...contextInitialState,
  ...experienceInitialState,
  ...homeInitialState,
  ...identityInitialState,
  ...preferenceInitialState,
  activeParams: undefined,
  activeParamsKey: undefined,
  editingMemoryContent: undefined,
  editingMemoryId: undefined,
  editingMemoryLayer: undefined,
  memoryDetailMap: {},
  memoryDetailReplica: createReplicaState<MemoryDetailDisplay>(),
  memoryFetchedAtMap: {},
  memoryMap: {},
  memoryRetrieveReplica: createReplicaState<RetrieveMemoryResult>(),
};
