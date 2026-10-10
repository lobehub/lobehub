import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { TestCaseDetail, TestCaseListValue } from './projection';

export interface TestCaseSliceState {
  /** Replica view of a test case addressed by its own id, for the case detail page. */
  testCaseDetailMap: Record<string, TestCaseDetail>;
  /** Replica bookkeeping of `testCaseDetailMap`. */
  testCaseDetailReplica: ReplicaState<TestCaseDetail>;
  /** Replica view of a dataset's case page (`testCaseListMap[datasetId]`). */
  testCaseListMap: Record<string, TestCaseListValue>;
  /** Replica bookkeeping of `testCaseListMap`. */
  testCaseListReplica: ReplicaState<TestCaseListValue>;
}

export const testCaseInitialState: TestCaseSliceState = {
  testCaseDetailMap: {},
  testCaseDetailReplica: createReplicaState(),
  testCaseListMap: {},
  testCaseListReplica: createReplicaState(),
};
