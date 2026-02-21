import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@lobechat/types';

import { type ActivitySliceState } from './slices/activity';
import { activityInitialState } from './slices/activity';
import { type AgentMemorySliceState } from './slices/agent';
import { agentMemoryInitialState } from './slices/agent';
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
  memoryFetchedAtMap: Record<string, number>;
  memoryMap: Record<string, RetrieveMemoryResult>;
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
  memoryFetchedAtMap: {},
  memoryMap: {},
  persona: undefined,
  personaInit: false,
  roles: [],
  tags: [],
  tagsInit: false,
};
