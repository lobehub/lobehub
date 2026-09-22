import { type DisplayContextMemory } from '@/database/repositories/userMemory';

export interface ContextSliceState {
  contexts: DisplayContextMemory[];
  contextsHasMore: boolean;
  contextsInit: boolean;
  contextsPage: number;
  contextsQuery?: string;
  contextsSearchError?: unknown;
  contextsSearchLoading?: boolean;
  contextsSort?: 'capturedAt' | 'scoreImpact' | 'scoreUrgency';
  contextsTotal: number;
}

export const contextInitialState: ContextSliceState = {
  contexts: [],
  contextsHasMore: true,
  contextsInit: false,
  contextsPage: 1,
  contextsQuery: undefined,
  contextsSearchError: undefined,
  contextsSearchLoading: undefined,
  contextsSort: undefined,
  contextsTotal: 0,
};
