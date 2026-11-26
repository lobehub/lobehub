import { Immer } from 'immer';

import { type EditorContentState } from './initialState';
import { createInitialEditorContentState } from './initialState';

// A long page's body is a multi-megabyte tree. Auto-freeze walks every body
// assigned here to freeze it, which costs tens of milliseconds per update on such
// a page, inside the document switch and on every edit. Stored bodies are never
// mutated: the editor clones whatever it loads.
const { produce } = new Immer({ autoFreeze: false });

// ============ Action Types ============

type AddDocumentAction = {
  id: string;
  type: 'addDocument';
  value: Partial<EditorContentState> & { sourceType: EditorContentState['sourceType'] };
};

type UpdateDocumentAction = {
  id: string;
  type: 'updateDocument';
  value: Partial<EditorContentState>;
};

type DeleteDocumentAction = {
  id: string;
  type: 'deleteDocument';
};

export type DocumentDispatch = AddDocumentAction | UpdateDocumentAction | DeleteDocumentAction;

// ============ Reducer ============

export const documentReducer = (
  state: Record<string, EditorContentState> = {},
  payload: DocumentDispatch,
): Record<string, EditorContentState> => {
  switch (payload.type) {
    case 'addDocument': {
      return produce(state, (draft) => {
        const { id, value } = payload;
        const existingDoc = draft[id];

        // Create new document state, merging with existing if present
        draft[id] = existingDoc
          ? { ...existingDoc, ...value }
          : createInitialEditorContentState(value.sourceType, value);
      });
    }

    case 'updateDocument': {
      return produce(state, (draft) => {
        const { id, value } = payload;
        const currentDoc = draft[id];

        if (currentDoc) {
          // Directly assign to let immer handle change detection
          Object.assign(draft[id], value);
        }
      });
    }

    case 'deleteDocument': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default: {
      return state;
    }
  }
};
