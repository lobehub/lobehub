'use client';

import { createContext, type PropsWithChildren, use } from 'react';
import { type DataRouter, UNSAFE_DataRouterContext } from 'react-router';
import { useStore } from 'zustand';
import { type StoreApi } from 'zustand/vanilla';

import { getRouterStore, type RouterStoreState } from './store';

const RouterStoreContext = createContext<StoreApi<RouterStoreState> | null>(null);

export const RouterStoreProvider = ({
  children,
  router,
  scopeId,
  store,
}: PropsWithChildren<{
  router?: DataRouter;
  scopeId?: string;
  store?: StoreApi<RouterStoreState>;
}>) => {
  const routerContext = use(UNSAFE_DataRouterContext);
  const routerStore =
    store ??
    (router || routerContext ? getRouterStore(router ?? routerContext!.router, scopeId) : null);

  if (!routerStore) throw new Error('RouterStoreProvider must be rendered inside a data router');

  return <RouterStoreContext value={routerStore}>{children}</RouterStoreContext>;
};

export const useRouterStore = <T,>(selector: (state: RouterStoreState) => T): T => {
  const providedStore = use(RouterStoreContext);
  const routerContext = use(UNSAFE_DataRouterContext);
  const store = providedStore ?? (routerContext ? getRouterStore(routerContext.router) : null);

  if (!store) throw new Error('useRouterStore must be rendered inside a data router');

  return useStore(store, selector);
};
