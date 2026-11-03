/**
 * Lobe Notebook Executor
 *
 * Creates and exports the NotebookExecutor instance for registration.
 * Injects notebookService as dependency.
 */
import { NotebookExecutor } from '@lobechat/builtin-tool-notebook/executor';

import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { notebookService } from '@/services/notebook';

// Create executor instance with client-side service
export const notebookExecutor = new NotebookExecutor(notebookService, {
  onDocumentsMutated: ({ documentId, topicId }) =>
    invalidateDocumentMutation({ cause: 'notebook', documentId, topicId }),
});
