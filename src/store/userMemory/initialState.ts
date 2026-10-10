import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@lobechat/types';

import { type ActivitySliceState } from './slices/activity';
import { activityInitialState } from './slices/activity';
import { type AgentMemorySliceState } from './slices/agent';
import { agentMemoryInitialState } from './slices/agent';
import { type ContextSliceState } from './slices/context';
import { contextInitialState } from './slices/context';
import { type ExperienceSliceState } from './slices/experience';
import { experienceInitialState } from './slices/experience';
import { homeInitialState, type HomeSliceState } from './slices/home/initialState';
import { type IdentitySliceState } from './slices/identity';
import { identityInitialState } from './slices/identity';
import { type PreferenceSliceState } from './slices/preference';
import { preferenceInitialState } from './slices/preference';

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
  memoryFetchedAtMap: Record<string, number>;
  memoryMap: Record<string, RetrieveMemoryResult>;
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
  memoryFetchedAtMap: {},
  memoryMap: {},
};
