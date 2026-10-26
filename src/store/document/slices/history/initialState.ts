import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  CompareHistoryItemsOutput,
  ListHistoryOutput,
} from '@/server/routers/lambda/_schema/documentHistory';

export interface DocumentHistoryState {
  /** Head-vs-version diffs, keyed by `documentHistoryCompareKey`. */
  historyCompareMap: Record<string, CompareHistoryItemsOutput>;
  historyCompareReplica: ReplicaState<CompareHistoryItemsOutput>;
  /** Version list per document. */
  historyListMap: Record<string, ListHistoryOutput>;
  historyListReplica: ReplicaState<ListHistoryOutput>;
}

export const initialDocumentHistoryState: DocumentHistoryState = {
  historyCompareMap: {},
  historyCompareReplica: createReplicaState(),
  historyListMap: {},
  historyListReplica: createReplicaState(),
};
