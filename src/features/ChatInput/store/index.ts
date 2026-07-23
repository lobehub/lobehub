'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import {
  createContext as createReactContext,
  createElement,
  type ReactNode,
  useContext,
  useRef,
} from 'react';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { createContext } from 'zustand-utils';

import { type Store } from './action';
import { store } from './action';
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

/**
 * Parallel context that mirrors the ChatInput store api. zustand-utils' own
 * context throws ("...used zustand provider as an ancestor.") when read without
 * a Provider, so it cannot answer "is there a store here?". Components reused
 * outside a chat input — e.g. the image/video generation prompt reuses
 * ChatInput's <Action> — read this to degrade gracefully instead of crashing.
 */
const ChatInputStoreApiContext = createReactContext<StoreApiWithSelector<Store> | undefined>(
  undefined,
);

/** The ChatInput store api, or `undefined` when rendered outside a Provider. */
export const useChatInputStoreApiOptional = (): StoreApiWithSelector<Store> | undefined =>
  useContext(ChatInputStoreApiContext);

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
