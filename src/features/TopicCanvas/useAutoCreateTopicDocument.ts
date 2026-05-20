'use client';

import type { NotebookDocument } from '@lobechat/types';
import { useEffect, useState } from 'react';

import { agentDocumentService } from '@/services/agentDocument';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { notebookSelectors, useNotebookStore } from '@/store/notebook';

interface UseAutoCreateTopicDocumentResult {
  document: NotebookDocument | undefined;
  documentId: string | undefined;
  isLoading: boolean;
}

const inflight = new Map<string, Promise<string | undefined>>();

/**
 * Fetch the topic-scoped document for a topic; auto-create one via the
 * agent-document pipeline when the list is empty, then associate it with the
 * topic through `topic_documents`. Returns the first document (topic → page is
 * 1:1 in practice).
 *
 * Deduplicates concurrent creations across component instances via a
 * module-level promise map keyed by topicId.
 */
export const useAutoCreateTopicDocument = (
  topicId: string | undefined,
  agentId: string | undefined,
): UseAutoCreateTopicDocumentResult => {
  const useFetchDocuments = useNotebookStore((s) => s.useFetchDocuments);
  const topicTitle = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.title : undefined,
  );
  const [createdDocument, setCreatedDocument] = useState<
    { documentId: string; topicId: string } | undefined
  >();

  const { isLoading } = useFetchDocuments(topicId);
  const documents = useNotebookStore(notebookSelectors.getDocumentsByTopicId(topicId));

  useEffect(() => {
    if (!topicId || !agentId || isLoading) return;
    if (documents.length > 0) return;

    let ignore = false;
    const promise =
      inflight.get(topicId) ??
      agentDocumentService
        .createForTopic({
          agentId,
          content: '',
          title: topicTitle?.trim() || '',
          topicId,
        })
        .then((document) => document.documentId)
        .catch((error) => {
          console.error('[TopicCanvas] Failed to auto-create topic document:', error);

          return undefined;
        })
        .finally(() => {
          inflight.delete(topicId);
        });

    if (!inflight.has(topicId)) inflight.set(topicId, promise);

    void promise.then((documentId) => {
      if (ignore || !documentId) return;
      setCreatedDocument({ documentId, topicId });
    });

    return () => {
      ignore = true;
    };
  }, [topicId, agentId, topicTitle, isLoading, documents.length]);

  const document = documents[0];
  const createdDocumentId =
    createdDocument && createdDocument.topicId === topicId ? createdDocument.documentId : undefined;

  return {
    document,
    documentId: document?.id ?? createdDocumentId,
    isLoading,
  };
};
