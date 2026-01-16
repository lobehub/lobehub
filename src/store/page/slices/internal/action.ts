import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand/vanilla';

import { setNamespace } from '@/utils/storeDebug';

import { type PageStore } from '../../store';
import { type DocumentsDispatch, documentsReducer } from './reducer';

const n = setNamespace('page/internal');

export interface InternalAction {
  /**
   * Dispatch action to update documents array
   */
  internal_dispatchDocuments: (payload: DocumentsDispatch, action?: string) => void;
}

export const createInternalSlice: StateCreator<
  PageStore,
  [['zustand/devtools', never]],
  [],
  InternalAction
> = (set, get) => ({
  internal_dispatchDocuments: (payload, action) => {
    const { documents } = get();
    const nextDocuments = documentsReducer(documents, payload);

    if (isEqual(documents, nextDocuments)) return;

    set({ documents: nextDocuments }, false, action ?? n(`dispatchDocuments/${payload.type}`));
  },
});
