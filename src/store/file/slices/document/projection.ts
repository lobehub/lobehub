import { defineReplica } from '@/libs/replica';
import { type LobeDocument } from '@/types/document';

/**
 * The value of one file-store document entry.
 *
 * Wrapped in an object on purpose: a replica value can never be `null` (the
 * engine reads `null` as "keep the current value"), but the resource manager
 * must tell "the server answered not found" (`document: null`) apart from
 * "nothing loaded yet" (no entry at all).
 */
export interface FileDocumentDetail {
  /** The document row, or `null` when the server has no such document. */
  document: LobeDocument | null;
}

/**
 * The file store's document rows, one entry per document id.
 *
 * The slice is a by-id detail cache: the resource manager resolves the item it
 * has open through it (page detection, title / emoji editing) and the create
 * flows insert the row they just made. Persisted to IndexedDB, so returning to
 * the resources route — or reloading a `?file=` deep link — paints from the
 * projection while the network only confirms it.
 *
 * The "not found" marker is never persisted: it is a page state, not a document.
 */
export const fileDocumentResource = defineReplica<string, FileDocumentDetail>({
  key: (id) => id,
  name: 'fileDocument',
  storage: 'indexedDB',
  version: 1,
});
