import { defineReplica } from '@/libs/replica';
import type {
  CompareHistoryItemsOutput,
  ListHistoryOutput,
} from '@/server/routers/lambda/_schema/documentHistory';

/** How many documents keep a persisted version list (`persist.maxEntries`). */
export const MAX_PERSISTED_HISTORY_LISTS = 20;
/**
 * How many version comparisons survive a reload. Each row holds two full
 * editor states, so the set is kept small.
 */
export const MAX_PERSISTED_HISTORY_COMPARES = 10;

export interface DocumentHistoryCompareParams {
  documentId: string;
  /** The version compared against the document head. */
  historyId: string;
}

export const documentHistoryCompareKey = ({
  documentId,
  historyId,
}: DocumentHistoryCompareParams) => `${documentId}:${historyId}`;

/**
 * The version list of one document (`historyListMap[documentId]`). A reload
 * opens the history panel on the last list it showed; the network confirms it.
 */
export const documentHistoryListResource = defineReplica<string, ListHistoryOutput>({
  key: (documentId) => documentId,
  name: 'documentHistoryList',
  persist: { maxEntries: MAX_PERSISTED_HISTORY_LISTS },
  storage: 'indexedDB',
  version: 1,
});

/** The head-vs-version diff (`historyCompareMap[documentHistoryCompareKey(params)]`). */
export const documentHistoryCompareResource = defineReplica<
  DocumentHistoryCompareParams,
  CompareHistoryItemsOutput
>({
  key: documentHistoryCompareKey,
  name: 'documentHistoryCompare',
  persist: { maxEntries: MAX_PERSISTED_HISTORY_COMPARES },
  storage: 'indexedDB',
  version: 1,
});
