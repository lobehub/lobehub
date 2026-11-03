'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { createContext } from 'zustand-utils';

import { createDevtools } from '@/store/middleware/createDevtools';

import { type CreateStoreParams, type Store } from './action';
import { createStoreAction } from './action';

export type { Store as ConversationStore, ConversationStore as Store } from './action';
export type { State } from './initialState';
export {
  contextSelectors,
  conversationSelectors,
  dataSelectors,
  inputSelectors,
  messageStateSelectors,
  virtuaListSelectors,
} from './selectors';

const devtools = createDevtools('conversation');

export const createStore = (params: CreateStoreParams) =>
  createWithEqualityFn(devtools(createStoreAction(params)), shallow);

export const {
  Provider,
  useStore: useConversationStore,
  useStoreApi: useConversationStoreApi,
} = createContext<StoreApiWithSelector<Store>>();
