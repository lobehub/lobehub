import { type DocumentType } from '@lobechat/builtin-tool-notebook';
import { type DocumentItem } from '@lobechat/database/schemas';
import { type NotebookDocument } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import { mutate } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { notebookService } from '@/services/notebook';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type NotebookStore } from './store';

const n = setNamespace('notebook');

const SWR_USE_FETCH_NOTEBOOK_DOCUMENTS = 'SWR_USE_FETCH_NOTEBOOK_DOCUMENTS';

type ExtendedDocumentType = DocumentType | 'agent/plan';

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
  readonly #get: () => NotebookStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => NotebookStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createDocument = async (params: CreateDocumentParams): Promise<DocumentItem> => {
    const document = await notebookService.createDocument(params);

    // Refresh the documents list
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, params.topicId]);

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

    // Refresh the documents list
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
  };

  refreshDocuments = async (topicId: string): Promise<void> => {
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
  };

  updateDocument = async (
    params: UpdateDocumentParams,
    topicId: string,
  ): Promise<DocumentItem | undefined> => {
    const document = await notebookService.updateDocument(params);

    // Refresh the documents list
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);

    return document;
  };

  useFetchDocuments = (topicId: string | undefined): SWRResponse<NotebookDocument[]> => {
    return useClientDataSWR<NotebookDocument[]>(
      topicId ? [SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId] : null,
      async () => {
        if (!topicId) return [];

        const result = await notebookService.listDocuments({ topicId });

        return result.data;
      },
      {
        onSuccess: (documents) => {
          if (!topicId) return;

          const currentDocuments = this.#get().notebookMap[topicId];

          // Skip update if data is the same
          if (currentDocuments && isEqual(documents, currentDocuments)) return;

          this.#set(
            {
              notebookMap: { ...this.#get().notebookMap, [topicId]: documents },
            },
            false,
            n('useFetchDocuments(onSuccess)', { topicId }),
          );
        },
      },
    );
  };
}

export type NotebookAction = Pick<NotebookActionImpl, keyof NotebookActionImpl>;
