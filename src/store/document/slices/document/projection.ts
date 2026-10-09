import type { DocumentItem } from '@lobechat/database/schemas';

import { defineReplica } from '@/libs/replica';

/**
 * The value of one document-detail entry.
 *
 * Wrapped in an object on purpose: a replica value can never be `null` (the
 * engine reads `null` as "keep the current value"), but the editor page must
 * tell "the server answered not found" (`document: null`, so it can settle on
 * its 404) apart from "nothing loaded yet" (no entry at all).
 */
export interface DocumentDetail {
  /** The server row, or `null` when the server has no such document. */
  document: DocumentItem | null;
}

/**
 * One document detail per entry, keyed by the document id it was opened with.
 * Persisted to IndexedDB: on a reload the editor's first frame comes from the
 * projection and the network only confirms it. The "not found" marker is never
 * persisted — it is a page state, not a document.
 */
export const documentDetailResource = defineReplica<string, DocumentDetail>({
  key: (id) => id,
  name: 'documentDetail',
  storage: 'indexedDB',
  version: 1,
});
