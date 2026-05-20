import type { StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type StoreSetter } from '../types';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore } from '../utils/resetableStore';
import { createFollowUpActionSlice, type FollowUpActionAction } from './action';
import { type FollowUpActionState, initialFollowUpActionState } from './initialState';

export type FollowUpActionStore = FollowUpActionState & FollowUpActionAction & ResetableStore;

class FollowUpActionStoreResetAction implements ResetableStore {
  readonly #api: StoreApi<FollowUpActionStore>;
  readonly #set: StoreSetter<FollowUpActionStore>;

  constructor(
    set: StoreSetter<FollowUpActionStore>,
    _get: () => FollowUpActionStore,
    api: StoreApi<FollowUpActionStore>,
  ) {
    void _get;
    this.#set = set;
    this.#api = api;
  }

  reset = () => {
    // Cancel any in-flight LLM call before wiping state, otherwise the AbortController is leaked.
    const current = this.#api.getState();
    current.abortController?.abort();
    // Explicitly include undefined fields so zustand's merge-mode setState clears them.
    this.#set(
      {
        abortController: undefined,
        chips: [],
        messageId: undefined,
        pendingTopicId: undefined,
        status: 'idle',
        topicId: undefined,
      },
      false,
      'resetFollowUpActionStore',
    );
  };
}

const createStore: StateCreator<FollowUpActionStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialFollowUpActionState,
  ...flattenActions<FollowUpActionAction & ResetableStore>([
    createFollowUpActionSlice(...parameters),
    new FollowUpActionStoreResetAction(...parameters),
  ]),
});

const devtools = createDevtools('followUpAction');

export const useFollowUpActionStore = createWithEqualityFn<FollowUpActionStore>()(
  devtools(createStore),
  shallow,
);

expose('followUpAction', useFollowUpActionStore);

export const getFollowUpActionStoreState = () => useFollowUpActionStore.getState();
