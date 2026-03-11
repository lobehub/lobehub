import isEqual from 'fast-deep-equal';

import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type PageStore } from '../../store';
import { type DocumentsDispatch } from './reducer';
import { documentsReducer } from './reducer';

const n = setNamespace('page/internal');

type Setter = StoreSetter<PageStore>;
export const createInternalSlice = (set: Setter, get: () => PageStore, _api?: unknown) =>
  new InternalActionImpl(set, get, _api);

export class InternalActionImpl {
  readonly #get: () => PageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => PageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_dispatchDocuments = (payload: DocumentsDispatch, action?: string): void => {
    const { documents } = this.#get();
    const nextDocuments = documentsReducer(documents, payload);

    if (isEqual(documents, nextDocuments)) return;

    this.#set(
      { documents: nextDocuments },
      false,
      action ?? n(`dispatchDocuments/${payload.type}`),
    );
  };
}

export type InternalAction = Pick<InternalActionImpl, keyof InternalActionImpl>;
