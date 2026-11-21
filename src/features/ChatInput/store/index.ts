'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import { createElement, type ReactNode, useRef } from 'react';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { createContext } from 'zustand-utils';

import { type Store } from './action';
import { store } from './action';
import { ChatInputStoreApiContext } from './apiContext';
import { type State } from './initialState';

export type { PublicState, State } from './initialState';

export const createStore = (initState?: Partial<State>) =>
  createWithEqualityFn(subscribeWithSelector(store(initState)), shallow);

const {
  useStore: useChatInputStore,
  useStoreApi,
  Provider: BaseProvider,
} = createContext<StoreApiWithSelector<Store>>();

export { useChatInputStore, useStoreApi };

export { useChatInputStoreApiOptional } from './apiContext';

/**
 * Wraps zustand-utils' Provider and additionally publishes the same store
 * instance through {@link ChatInputStoreApiContext} for optional reads. Keeps
 * the exact `{ createStore, children }` API of the original export.
 */
export const Provider = ({
  createStore: create,
  children,
}: {
  children: ReactNode;
  createStore: () => StoreApiWithSelector<Store>;
}) => {
  const storeRef = useRef<StoreApiWithSelector<Store> | undefined>(undefined);
  if (!storeRef.current) storeRef.current = create();
  const storeApi = storeRef.current;

  return createElement(BaseProvider, {
    children: createElement(ChatInputStoreApiContext.Provider, { children, value: storeApi }),
    createStore: () => storeApi,
  });
};

export { selectors } from './selectors';
