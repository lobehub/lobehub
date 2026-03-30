import type { StateCreator } from 'zustand/vanilla';

import type { ResourceManagerMode } from '@/features/ResourceManager';
import type { StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';

import type { State } from './initialState';
import { initialState } from './initialState';

export type Store = Action & State;

type Setter = StoreSetter<Store>;

export class ResourceStoreActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, _get: () => Store, _api?: unknown) {
    void _api;
    void _get;
    this.#set = set;
  }

  setCurrentViewItemId = (currentViewItemId?: string): void => {
    this.#set({ currentViewItemId });
  };

  setMode = (mode: ResourceManagerMode): void => {
    this.#set({ mode });
  };

  setSelectedFileIds = (selectedFileIds: string[]): void => {
    this.#set({ selectedFileIds });
  };
}

export type Action = Pick<ResourceStoreActionImpl, keyof ResourceStoreActionImpl>;

export const createResourceStoreSlice = (set: Setter, get: () => Store, _api?: unknown) =>
  new ResourceStoreActionImpl(set, get, _api);

type CreateStore = (
  initState?: Partial<State>,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const store: CreateStore =
  (publicState) =>
  (...params) => ({
    ...initialState,
    ...publicState,
    ...flattenActions<Action>([createResourceStoreSlice(...params)]),
  });
