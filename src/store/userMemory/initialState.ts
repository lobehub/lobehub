import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type ActivitySliceState } from './slices/activity';
import { activityInitialState } from './slices/activity';
import { type AgentMemorySliceState } from './slices/agent';
import { agentMemoryInitialState } from './slices/agent';
import { type MemoryDetailDisplay } from './slices/base/projection';
import { type ContextSliceState } from './slices/context';
import { contextInitialState } from './slices/context';
import { type ExperienceSliceState } from './slices/experience';
import { experienceInitialState } from './slices/experience';
import { type IdentitySliceState } from './slices/identity';
import { identityInitialState } from './slices/identity';
import { type PreferenceSliceState } from './slices/preference';
import { preferenceInitialState } from './slices/preference';

export interface PersonaData {
  content: string;
  summary: string;
}

export interface UserMemoryStoreState
  extends
    ActivitySliceState,
    AgentMemorySliceState,
    ContextSliceState,
    ExperienceSliceState,
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
  persona?: PersonaData;
  personaInit: boolean;
  roles: { count: number; tag: string }[];
  tags: { count: number; tag: string }[];
  tagsInit: boolean;
}

export const initialState: UserMemoryStoreState = {
  ...activityInitialState,
  ...agentMemoryInitialState,
  ...contextInitialState,
  ...experienceInitialState,
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
  persona: undefined,
  personaInit: false,
  roles: [],
  tags: [],
  tagsInit: false,
};
