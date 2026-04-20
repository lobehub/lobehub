import type { StoreApi } from 'zustand';

import type { StoreSetter } from '@/store/types';

export interface ResetableStore {
  reset: () => void;
}

type Setter<TStore extends object> = StoreSetter<TStore>;

export abstract class ResetableStoreAction<TStore extends object> implements ResetableStore {
  readonly #api: StoreApi<TStore>;
  readonly #set: Setter<TStore>;

  protected abstract readonly resetActionName: string;

  constructor(set: Setter<TStore>, _get: () => TStore, api: StoreApi<TStore>) {
    void _get;
    this.#set = set;
    this.#api = api;
  }

  reset = () => {
    this.#set(this.#api.getInitialState(), false, this.resetActionName);
  };
}
