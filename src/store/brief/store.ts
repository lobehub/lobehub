import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { isDev } from '@/utils/env';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type BriefStoreState, initialState } from './initialState';
import { type BriefListAction, createBriefListSlice } from './slices/list/action';

//  ===============  Aggregate createStoreFn ============ //

export interface BriefStore extends BriefListAction, BriefStoreState {}

const createStore: StateCreator<BriefStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<BriefStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<BriefListAction>([createBriefListSlice(...parameters)]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('brief');

export const useBriefStore = createWithEqualityFn<BriefStore>()(
  subscribeWithSelector(
    devtools(createStore, {
      name: 'LobeChat_Brief' + (isDev ? '_DEV' : ''),
    }),
  ),
  shallow,
);

expose('brief', useBriefStore);

export const getBriefStoreState = () => useBriefStore.getState();
