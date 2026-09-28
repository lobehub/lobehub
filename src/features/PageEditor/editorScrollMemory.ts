/**
 * Session-scoped scroll memory for the page editor, keyed by document id.
 *
 * Each document remembers its own scroll offset (Yuque-style): revisiting a
 * document restores where the reader left off, while a document that was never
 * opened starts at the top. Kept in memory only — it lives for the tab's
 * lifetime and never leaks into persisted storage.
 */
const MAX_REMEMBERED_DOCUMENTS = 200;

const scrollTopByDocument = new Map<string, number>();

export const rememberEditorScrollTop = (documentId: string | undefined, scrollTop: number) => {
  if (!documentId) return;

  // Re-insert so the map keeps insertion order as recency for the LRU cap.
  scrollTopByDocument.delete(documentId);
  scrollTopByDocument.set(documentId, Math.max(scrollTop, 0));

  if (scrollTopByDocument.size > MAX_REMEMBERED_DOCUMENTS) {
    const oldest = scrollTopByDocument.keys().next().value;
    if (oldest !== undefined) scrollTopByDocument.delete(oldest);
  }
};

export const recallEditorScrollTop = (documentId: string | undefined) =>
  documentId ? (scrollTopByDocument.get(documentId) ?? 0) : 0;

export const forgetEditorScrollTop = (documentId: string | undefined) => {
  if (documentId) scrollTopByDocument.delete(documentId);
};

/** Test-only helper. */
export const resetEditorScrollMemory = () => scrollTopByDocument.clear();
