import { type DocumentType } from '@lobechat/builtin-tool-notebook';
import type { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import { type DocumentItem } from '@lobechat/database/schemas';
import { type NotebookDocument } from '@lobechat/types';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { notebookService } from '@/services/notebook';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { notebookDocumentsResource } from './projection';
import { type NotebookStore } from './store';

const n = setNamespace('notebook');

type ExtendedDocumentType = DocumentType | typeof AGENT_PLAN_FILE_TYPE;

interface CreateDocumentParams {
  content: string;
  description: string;
  metadata?: Record<string, any>;
  title: string;
  topicId: string;
  type?: ExtendedDocumentType;
}

interface UpdateDocumentParams {
  content?: string;
  description?: string;
  id: string;
  metadata?: Record<string, any>;
  title?: string;
}

type Setter = StoreSetter<NotebookStore>;
export const createNotebookAction = (set: Setter, get: () => NotebookStore, _api?: unknown) =>
  new NotebookActionImpl(set, get, _api);

export class NotebookActionImpl {
  /** One topic's documents, persisted per `topicId` (`notebookMap`). */
  readonly #documents;

  constructor(set: Setter, get: () => NotebookStore, _api?: unknown) {
    void _api;
    this.#documents = createReplicaSlice(notebookDocumentsResource, {
      actionPrefix: n('notebookDocuments'),
      fetcher: (topicId) =>
        notebookService.listDocuments({ topicId }).then((result) => result.data),
      get,
      set,
      stateKey: 'notebookDocumentsReplica',
      view: recordLens<NotebookStore, NotebookDocument[]>('notebookMap'),
    });
  }

  createDocument = async (params: CreateDocumentParams): Promise<DocumentItem> => {
    const document = await notebookService.createDocument(params);

    await invalidateDocumentMutation({
      cause: 'notebook',
      documentId: document.id,
      topicId: params.topicId,
    });

    return document;
  };

  deleteDocument = async (id: string, topicId: string): Promise<void> => {
    // If the deleted document is currently open, close it
    const portalDocumentId = useChatStore.getState().portalDocumentId;
    if (portalDocumentId === id) {
      useChatStore.getState().closeDocument();
    }

    // Call API to delete
    await notebookService.deleteDocument(id);

    await invalidateDocumentMutation({ cause: 'notebook', documentId: id, topicId });
  };

  /**
   * Force a fresh sync of one topic's documents (or every loaded topic). The
   * list is read through `notebookSelectors`; this only schedules the network
   * round-trip, so the caller never touches the replica directly.
   */
  refreshDocuments = async (topicId: string): Promise<void> => {
    await this.#documents.revalidate(topicId);
  };

  updateDocument = async (
    params: UpdateDocumentParams,
    topicId: string,
  ): Promise<DocumentItem | undefined> => {
    const document = await notebookService.updateDocument(params);

    await invalidateDocumentMutation({ cause: 'notebook', documentId: params.id, topicId });

    return document;
  };

  /**
   * Fetch orchestration for one topic: the persisted copy paints the first
   * frame and the network only confirms. Read the documents with
   * `notebookSelectors`, not from the return value.
   */
  useFetchDocuments = (topicId: string | undefined): ReplicaSyncResult =>
    this.#documents.useSync(topicId ?? null, { revalidateOnFocus: false });
}

export type NotebookAction = Pick<NotebookActionImpl, keyof NotebookActionImpl>;
