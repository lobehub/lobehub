import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { TestCaseDetail, TestCaseListValue } from './projection';

export interface TestCaseSliceState {
  /** Replica view of a test case addressed by its own id, for the case detail page. */
  testCaseDetailMap: Record<string, TestCaseDetail>;
  /** Replica bookkeeping of `testCaseDetailMap`. */
  testCaseDetailReplica: ReplicaState<TestCaseDetail>;
  /** Replica view of the visited case pages, one entry per page query (`testCaseListQueryKey`). */
  testCaseListMap: Record<string, TestCaseListValue>;
  /** Replica bookkeeping of `testCaseListMap`. */
  testCaseListReplica: ReplicaState<TestCaseListValue>;
  /**
   * The dataset-wide case count, as the latest page response reported it. It
   * lives beside the per-page entries so that switching to a page whose rows are
   * still loading never collapses the pager to 0.
   */
  testCaseTotalMap: Record<string, number>;
}

export const testCaseInitialState: TestCaseSliceState = {
  testCaseDetailMap: {},
  testCaseDetailReplica: createReplicaState(),
  testCaseListMap: {},
  testCaseListReplica: createReplicaState(),
  testCaseTotalMap: {},
};
