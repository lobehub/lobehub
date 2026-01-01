import type { RetrieveMemoryParams, RetrieveMemoryResult } from '@lobechat/types';

import {
  type DisplayContextMemory,
  type DisplayExperienceMemory,
  type DisplayPreferenceMemory,
} from '@/database/repositories/userMemory';

import { type AgentMemorySliceState, agentMemoryInitialState } from './slices/agent';
import { type IdentitySliceState, identityInitialState } from './slices/identity';

export interface UserMemoryStoreState extends AgentMemorySliceState, IdentitySliceState {
  activeParams?: RetrieveMemoryParams;
  activeParamsKey?: string;
  contexts: DisplayContextMemory[];
  contextsHasMore: boolean;
  contextsInit: boolean;
  contextsPage: number;
  contextsQuery?: string;
  contextsSearchLoading?: boolean;
  contextsSort?: 'scoreImpact' | 'scoreUrgency';
  contextsTotal: number;
  editingMemoryContent?: string;
  editingMemoryId?: string;
  editingMemoryLayer?: 'context' | 'experience' | 'identity' | 'preference';
  experiences: DisplayExperienceMemory[];
  experiencesHasMore: boolean;
  experiencesInit: boolean;
  experiencesPage: number;
  experiencesQuery?: string;
  experiencesSearchLoading?: boolean;
  experiencesSort?: 'scoreConfidence';
  experiencesTotal: number;
  memoryFetchedAtMap: Record<string, number>;
  memoryMap: Record<string, RetrieveMemoryResult>;
  preferences: DisplayPreferenceMemory[];
  preferencesHasMore: boolean;
  preferencesInit: boolean;
  preferencesPage: number;
  preferencesQuery?: string;
  preferencesSearchLoading?: boolean;
  preferencesSort?: 'scorePriority';
  preferencesTotal: number;
  roles: { count: number; tag: string }[];
  tags: { count: number; tag: string }[];
  tagsInit: boolean;
}

export const initialState: UserMemoryStoreState = {
  ...agentMemoryInitialState,
  ...identityInitialState,
  activeParams: undefined,
  activeParamsKey: undefined,
  contexts: [],
  contextsHasMore: true,
  contextsInit: false,
  contextsPage: 1,
  contextsQuery: undefined,
  contextsSort: undefined,
  contextsTotal: 0,
  editingMemoryContent: undefined,
  editingMemoryId: undefined,
  editingMemoryLayer: undefined,
  experiences: [],
  experiencesHasMore: true,
  experiencesInit: false,
  experiencesPage: 1,
  experiencesQuery: undefined,
  experiencesSort: undefined,
  experiencesTotal: 0,
  memoryFetchedAtMap: {},
  memoryMap: {},
  preferences: [],
  preferencesHasMore: true,
  preferencesInit: false,
  preferencesPage: 1,
  preferencesQuery: undefined,
  preferencesSort: undefined,
  preferencesTotal: 0,
  roles: [],
  tags: [],
  tagsInit: false,
};
