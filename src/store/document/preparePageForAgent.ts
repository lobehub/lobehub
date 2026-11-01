import { PAGE_SYNC_WAIT_MS, waitForPageSynced } from './collabRegistry';
import { useDocumentStore } from './store';

/**
 * Gets the open page ready for the agent to read before a page-scoped send.
 * A room page merges edits either way, so it only waits for pending updates
 * and reports whether they synced; a stored page is saved so the agent reads
 * what the user typed.
 */
export const preparePageForAgent = async (documentId: string): Promise<'notSynced' | 'ready'> => {
  const doc = useDocumentStore.getState().documents[documentId];
  if (doc?.collab) {
    return (await waitForPageSynced(documentId, PAGE_SYNC_WAIT_MS)) ? 'ready' : 'notSynced';
  }
  if (doc?.isDirty) await useDocumentStore.getState().performSave(documentId);
  return 'ready';
};
