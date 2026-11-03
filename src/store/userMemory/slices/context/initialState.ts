import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { memoryListKey } from '../../utils/replica';
import { type ContextListData, type ContextListSort } from './projection';

/**
 * The context list is a `local-replica` paged resource with one page set
 * per search / sort (`contextListEntries`). The long-standing flat fields
 * (`contextListData`, `contexts`, `contextsTotal`, `contextsPage`,
 * `contextsHasMore`, `contextsInit`) mirror the active query's entry so every
 * existing consumer keeps reading the place it always has.
 */
export interface ContextSliceState {
  /** View of the active query's page set. Mirror of `contextListEntries[contextListKey]`. */
  contextListData?: ContextListData;
  /** Canonical replica views, one page set per query. Engine-owned. */
  contextListEntries: Record<string, ContextListData>;
  /** Entry key of the query on screen (see `memoryListKey`). */
  contextListKey: string;
  /** Local-first bookkeeping for `contextListEntries`. */
  contextListReplica: ReplicaState<ContextListData>;
  /** Rows of the active page set. Mirror of `contextListData.items`. */
  contexts: DisplayContextMemory[];
  /** Mirror of `contextListData.hasMore`. */
  contextsHasMore: boolean;
  /** Whether the active query has a view (persisted row hydrated or a page landed). */
  contextsInit: boolean;
  /** Mirror of `contextListData.currentPage + 1`. */
  contextsPage: number;
  contextsQuery?: string;
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
  contextsSort: undefined,
  contextsTotal: 0,
  contextListData: undefined,
  contextListEntries: {},
  contextListKey: memoryListKey({}),
  contextListReplica: createReplicaState<ContextListData>(),
};
