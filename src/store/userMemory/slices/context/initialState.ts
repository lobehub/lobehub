import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type ContextListData, type ContextListSort } from './projection';

/**
 * The context list is a `@lobechat/replica` paged resource. Its canonical value
 * lives in `contextListData`; the long-standing flat fields (`contexts`,
 * `contextsTotal`, `contextsPage`, `contextsHasMore`, `contextsInit`) are
 * derived mirrors of that view so every existing consumer keeps reading the
 * place it always has.
 */
export interface ContextSliceState {
  /**
   * Canonical replica view of the context list — the single source of truth
   * behind every `contexts*` field below. Engine-owned; readers use the flat
   * mirrors.
   */
  contextListData?: ContextListData;
  /** Local-first bookkeeping for `contextListData`. */
  contextListReplica: ReplicaState<ContextListData>;
  /** Rows of the loaded page set. Mirror of `contextListData.items`. */
  contexts: DisplayContextMemory[];
  /** Mirror of `contextListData.hasMore`. */
  contextsHasMore: boolean;
  /** Whether the replica view exists (persisted row hydrated or a page landed). */
  contextsInit: boolean;
  /** Mirror of `contextListData.currentPage + 1`. */
  contextsPage: number;
  contextsQuery?: string;
  contextsSearchError?: unknown;
  contextsSearchLoading?: boolean;
  contextsSort?: ContextListSort;
  /** Mirror of `contextListData.total`. */
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
  contextListData: undefined,
  contextListReplica: createReplicaState<ContextListData>(),
};
