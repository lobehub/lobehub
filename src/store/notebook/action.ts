import { type DocumentType } from '@lobechat/builtin-tool-notebook';
import { type DocumentItem } from '@lobechat/database/schemas';
import { type NotebookDocument } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse, mutate } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { notebookService } from '@/services/notebook';
import { useChatStore } from '@/store/chat';
import { setNamespace } from '@/utils/storeDebug';

import type { NotebookStore } from './store';

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

export interface NotebookAction {
  createDocument: (params: CreateDocumentParams) => Promise<DocumentItem>;
  deleteDocument: (id: string, topicId: string) => Promise<void>;
  refreshDocuments: (topicId: string) => Promise<void>;
  updateDocument: (
    params: UpdateDocumentParams,
    topicId: string,
  ) => Promise<DocumentItem | undefined>;
  useFetchDocuments: (topicId: string | undefined) => SWRResponse<NotebookDocument[]>;
}

export const createNotebookAction: StateCreator<
  NotebookStore,
  [['zustand/devtools', never]],
  [],
  NotebookAction
> = (set, get) => ({
  createDocument: async (params) => {
    const document = await notebookService.createDocument(params);

    // Refresh the documents list
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, params.topicId]);

    return document;
  },

  deleteDocument: async (id, topicId) => {
    // If the deleted document is currently open, close it
    const portalDocumentId = useChatStore.getState().portalDocumentId;
    if (portalDocumentId === id) {
      useChatStore.getState().closeDocument();
    }

    // Call API to delete
    await notebookService.deleteDocument(id);

    // Refresh the documents list
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
  },

  refreshDocuments: async (topicId) => {
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
  },

  updateDocument: async (params, topicId) => {
    const document = await notebookService.updateDocument(params);

    // Refresh the documents list
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);

    return document;
  },

  useFetchDocuments: (topicId) => {
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

          const currentDocuments = get().notebookMap[topicId];

          // Skip update if data is the same
          if (currentDocuments && isEqual(documents, currentDocuments)) return;

          set(
            {
              notebookMap: { ...get().notebookMap, [topicId]: documents },
            },
            false,
            n('useFetchDocuments(onSuccess)', { topicId }),
          );
        },
      },
    );
  },
});
