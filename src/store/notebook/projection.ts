import { type NotebookDocument } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export type { NotebookDocument };

/**
 * One topic's notebook documents, keyed by `topicId` (`notebookMap[topicId]`).
 *
 * Read-mostly: the notebook tool executor and the portal's delete are the
 * writers, and both revalidate this entry through `invalidateDocumentMutation`
 * (see `@/services/document/invalidation`). The persisted copy therefore paints
 * the topic's first frame and the network only confirms. IndexedDB, not
 * localStorage, because the list is only read once a topic's notebook or
 * document portal is open.
 */
export const notebookDocumentsResource = defineReplica<string, NotebookDocument[]>({
  key: (topicId) => topicId,
  name: 'notebookDocuments',
  storage: 'indexedDB',
  version: 1,
});
