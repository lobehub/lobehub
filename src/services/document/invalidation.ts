import { mutate } from '@/libs/swr';

import { agentDocumentSWRKeys, documentSWRKeys, notebookSWRKeys } from './swrKeys';

export type DocumentMutationCause =
  | 'agent-document'
  | 'document-service'
  | 'notebook'
  | 'page-title';

export interface InvalidateDocumentMutationParams {
  agentDocumentId?: string;
  agentId?: string;
  cause?: DocumentMutationCause;
  documentId?: string;
  refreshDocumentEditor?: boolean;
  refreshPageDocuments?: boolean;
  topicId?: string;
}

export const invalidateDocumentMutation = async (
  params: InvalidateDocumentMutationParams,
): Promise<void> => {
  const {
    agentDocumentId,
    agentId,
    documentId,
    refreshDocumentEditor,
    refreshPageDocuments,
    topicId,
  } = params;
  const revalidations: Promise<unknown>[] = [];

  if (documentId) {
    if (refreshDocumentEditor !== false) {
      revalidations.push(mutate(documentSWRKeys.editor(documentId)));
    }
    revalidations.push(mutate(documentSWRKeys.pageDetail(documentId)));
    revalidations.push(mutate(documentSWRKeys.pageMeta(documentId)));
  }

  if (documentId || refreshPageDocuments) {
    revalidations.push(mutate(documentSWRKeys.pageDocuments()));
  }

  if (topicId) {
    revalidations.push(mutate(notebookSWRKeys.documents(topicId)));
  }

  if (agentId) {
    revalidations.push(mutate(agentDocumentSWRKeys.documents(agentId)));
    revalidations.push(mutate(agentDocumentSWRKeys.documentsList(agentId)));
  }

  if (agentId && agentDocumentId) {
    revalidations.push(mutate(agentDocumentSWRKeys.readDocument(agentId, agentDocumentId)));
  }

  const results = await Promise.allSettled(revalidations);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[DocumentInvalidation] Failed to revalidate document cache:', result.reason);
    }
  }
};
