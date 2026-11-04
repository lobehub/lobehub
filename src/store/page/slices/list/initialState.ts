import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { LobeDocument } from '@/types/document';

import type { PageListValue, PageSectionListValue } from '../../projection';

export interface PageListSliceState {
  /**
   * By-id page cache, read by `getDocumentById` as a fallback behind the list.
   * Filled for pages opened outside the loaded list (mobile, deep links) — the
   * editor's title / emoji / workspace lock state resolve from here.
   */
  pageDetailMap: Record<string, LobeDocument>;
  /** Local-first bookkeeping for `pageDetailMap`. */
  pageDetailReplica: ReplicaState<LobeDocument>;
  /**
   * The paged page list (`pageListMap.all`), what the sidebar reads. The map
   * shape keeps the door open for another list query without moving fields.
   */
  pageListMap: Record<string, PageListValue>;
  /** Local-first bookkeeping for `pageListMap`. */
  pageListReplica: ReplicaState<PageListValue>;
  /** Every page of a section, paged for the full-list panel (`pageSectionListMap[mine|shared]`). */
  pageSectionListMap: Record<string, PageSectionListValue>;
  /** Local-first bookkeeping for `pageSectionListMap`. */
  pageSectionListReplica: ReplicaState<PageSectionListValue>;
  /** The Docs sidebar's page sections (`pageSectionMap[mine|shared]`). */
  pageSectionMap: Record<string, LobeDocument[]>;
  /** Local-first bookkeeping for `pageSectionMap`. */
  pageSectionReplica: ReplicaState<LobeDocument[]>;
}

export const initialPageListState: PageListSliceState = {
  pageDetailMap: {},
  pageDetailReplica: createReplicaState(),
  pageListMap: {},
  pageListReplica: createReplicaState(),
  pageSectionListMap: {},
  pageSectionListReplica: createReplicaState(),
  pageSectionMap: {},
  pageSectionReplica: createReplicaState(),
};
