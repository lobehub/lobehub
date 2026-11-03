import type { StoreApi } from 'zustand';

export interface StoreApiWithSelector<Store> extends Omit<StoreApi<Store>, 'subscribe'> {
  subscribe: <T extends keyof Store>(
    selector: (state: Store, prevState: Store) => void,
    listener?: (state: Store[T]) => void,
  ) => () => void;
}
