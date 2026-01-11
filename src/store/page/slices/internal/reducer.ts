import { produce } from 'immer';

import { type LobeDocument } from '@/types/document';

// ============ Action Types ============

interface AddDocumentAction {
  document: LobeDocument;
  type: 'addDocument';
}

interface RemoveDocumentAction {
  id: string;
  type: 'removeDocument';
}

interface UpdateDocumentAction {
  document: LobeDocument;
  id: string;
  type: 'updateDocument';
}

interface ReplaceDocumentAction {
  document: LobeDocument;
  oldId: string;
  type: 'replaceDocument';
}

interface SetDocumentsAction {
  documents: LobeDocument[];
  type: 'setDocuments';
}

interface AppendDocumentsAction {
  documents: LobeDocument[];
  type: 'appendDocuments';
}

export type DocumentsDispatch =
  | AddDocumentAction
  | RemoveDocumentAction
  | UpdateDocumentAction
  | ReplaceDocumentAction
  | SetDocumentsAction
  | AppendDocumentsAction;

// ============ Reducer ============

export const documentsReducer = (
  state: LobeDocument[] | undefined,
  payload: DocumentsDispatch,
): LobeDocument[] | undefined => {
  switch (payload.type) {
    case 'addDocument': {
      return produce(state ?? [], (draft) => {
        // Add to the beginning
        draft.unshift(payload.document);
      });
    }

    case 'removeDocument': {
      if (!state) return state;
      return produce(state, (draft) => {
        const index = draft.findIndex((doc) => doc.id === payload.id);
        if (index !== -1) {
          draft.splice(index, 1);
        }
      });
    }

    case 'updateDocument': {
      if (!state) return state;
      return produce(state, (draft) => {
        const index = draft.findIndex((doc) => doc.id === payload.id);
        if (index !== -1) {
          draft[index] = payload.document;
        }
      });
    }

    case 'replaceDocument': {
      if (!state) return [payload.document];
      return produce(state, (draft) => {
        const index = draft.findIndex((doc) => doc.id === payload.oldId);
        if (index !== -1) {
          draft[index] = payload.document;
        }
      });
    }

    case 'setDocuments': {
      return payload.documents;
    }

    case 'appendDocuments': {
      return produce(state ?? [], (draft) => {
        draft.push(...payload.documents);
      });
    }

    default: {
      return state;
    }
  }
};
