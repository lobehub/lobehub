'use client';

import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type DocumentStore } from '../../store';

const n = setNamespace('document/preview');

type Setter = StoreSetter<DocumentStore>;

export const createPreviewSlice = (set: Setter, get: () => DocumentStore, _api?: unknown) =>
  new PreviewActionImpl(set, get, _api);

export class PreviewActionImpl {
  readonly #get: () => DocumentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DocumentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  openDocumentPreview = (documentId: string): void => {
    if (this.#get().previewDocumentId === documentId) return;
    this.#set({ previewDocumentId: documentId }, false, n('openDocumentPreview'));
  };

  closeDocumentPreview = (): void => {
    if (!this.#get().previewDocumentId) return;
    this.#set({ previewDocumentId: undefined }, false, n('closeDocumentPreview'));
  };
}

export type PreviewAction = Pick<PreviewActionImpl, keyof PreviewActionImpl>;
