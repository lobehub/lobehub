'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { createContext } from 'zustand-utils';

import { type Store } from './action';
import { store } from './action';

export type { State } from './initialState';

export const createStore = () => createWithEqualityFn(subscribeWithSelector(store), shallow);

export const { useStore, useStoreApi, Provider } = createContext<StoreApiWithSelector<Store>>();

export { selectors } from './selectors';
