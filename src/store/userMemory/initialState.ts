import type { RetrieveMemoryParams, RetrieveMemoryResult } from '@lobechat/types';

import { type AgentMemorySliceState, agentMemoryInitialState } from './slices/agent';
import { type ContextSliceState, contextInitialState } from './slices/context';
import { type ExperienceSliceState, experienceInitialState } from './slices/experience';
import { type IdentitySliceState, identityInitialState } from './slices/identity';
import { type PreferenceSliceState, preferenceInitialState } from './slices/preference';

export interface PersonaData {
  content: string;
  summary: string;
}

export interface UserMemoryStoreState
  extends
    AgentMemorySliceState,
    ContextSliceState,
    ExperienceSliceState,
    IdentitySliceState,
    PreferenceSliceState {
  activeParams?: RetrieveMemoryParams;
  activeParamsKey?: string;
  editingMemoryContent?: string;
  editingMemoryId?: string;
  editingMemoryLayer?: 'context' | 'experience' | 'identity' | 'preference';
  memoryFetchedAtMap: Record<string, number>;
  memoryMap: Record<string, RetrieveMemoryResult>;
  persona?: PersonaData;
  personaInit: boolean;
  roles: { count: number; tag: string }[];
  tags: { count: number; tag: string }[];
  tagsInit: boolean;
}

export const initialState: UserMemoryStoreState = {
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
