export interface DocumentRefRow {
  documentId: string;
  fileType?: string | null;
  id: string;
  parentId?: string | null;
  title?: string | null;
}

export type DocumentRefLookup = (ref?: string | null) => DocumentRefRow | undefined;

export type DocumentRefView =
  | { kind: 'root' }
  | { kind: 'document' | 'folder'; title: string }
  | { id: string; kind: 'unknown' };

/**
 * How a tool-call id reads to the user: the root, a folder or document by its
 * title, or — when the id no longer resolves and no title came with the result —
 * an unknown id. Tool arguments carry either the row `id` or the `docs_…` id.
 */
export const describeDocumentRef = (
  lookup: DocumentRefLookup,
  ref?: string | null,
  fallbackTitle?: string,
): DocumentRefView => {
  if (!ref) return { kind: 'root' };
  const doc = lookup(ref);
  const title = doc?.title || fallbackTitle;
  if (!title) return { id: ref, kind: 'unknown' };
  return { kind: doc?.fileType === 'custom/folder' ? 'folder' : 'document', title };
};

/** Where a document sits now: its parent's view, the root when it has none. */
export const describeCurrentParent = (lookup: DocumentRefLookup, ref: string): DocumentRefView =>
  describeDocumentRef(lookup, lookup(ref)?.parentId ?? null);
