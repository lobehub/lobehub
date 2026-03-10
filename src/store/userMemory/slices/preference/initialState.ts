import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';

export interface PreferenceSliceState {
  preferences: DisplayPreferenceMemory[];
  preferencesHasMore: boolean;
  preferencesInit: boolean;
  preferencesPage: number;
  preferencesQuery?: string;
  preferencesSearchLoading?: boolean;
  preferencesSort?: 'capturedAt' | 'scorePriority';
  preferencesTotal: number;
}

export const preferenceInitialState: PreferenceSliceState = {
  preferences: [],
  preferencesHasMore: true,
  preferencesInit: false,
  preferencesPage: 1,
  preferencesQuery: undefined,
  preferencesSort: undefined,
  preferencesTotal: 0,
};
