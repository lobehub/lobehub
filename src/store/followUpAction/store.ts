import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { createFollowUpActionSlice, type FollowUpActionAction } from './action';
import { type FollowUpActionState, initialFollowUpActionState } from './initialState';

export type FollowUpActionStore = FollowUpActionState & FollowUpActionAction & ResetableStore;

class FollowUpActionStoreResetAction extends ResetableStoreAction<FollowUpActionStore> {
  protected readonly resetActionName = 'resetFollowUpActionStore';
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
