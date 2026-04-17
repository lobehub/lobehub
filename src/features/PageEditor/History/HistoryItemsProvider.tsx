'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import type { PropsWithChildren } from 'react';
import { memo, useLayoutEffect } from 'react';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';
import { createContext } from 'zustand-utils';

import type { DocumentHistoryListItem } from '@/server/routers/lambda/_schema/documentHistory';

interface State {
  itemsById: Record<string, DocumentHistoryListItem>;
  restoringHistoryId: string | null;
}

interface Action {
  setHistoryItems: (items: DocumentHistoryListItem[]) => void;
  setRestoringHistoryId: (historyId: string | null) => void;
}

type Store = State & Action;

const hasSameHistoryItem = (a: DocumentHistoryListItem, b: DocumentHistoryListItem) =>
  a.id === b.id &&
  a.isCurrent === b.isCurrent &&
  a.savedAt === b.savedAt &&
  a.saveSource === b.saveSource;

const buildItemsById = (
  items: DocumentHistoryListItem[],
  previousItemsById: Record<string, DocumentHistoryListItem>,
) => {
  const nextItemsById: Record<string, DocumentHistoryListItem> = {};
  let reusedCount = 0;

  for (const item of items) {
    const previousItem = previousItemsById[item.id];
    const nextItem = previousItem && hasSameHistoryItem(previousItem, item) ? previousItem : item;

    nextItemsById[item.id] = nextItem;

    if (nextItem === previousItem) {
      reusedCount += 1;
    }
  }

  if (Object.keys(previousItemsById).length !== items.length) {
    return nextItemsById;
  }

  return reusedCount === items.length ? previousItemsById : nextItemsById;
};

const store: StateCreator<Store, [['zustand/devtools', never]]> = (set, get) => ({
  itemsById: {},
  restoringHistoryId: null,

  setHistoryItems: (items) => {
    const nextItemsById = buildItemsById(items, get().itemsById);

    if (nextItemsById === get().itemsById) return;

    set({ itemsById: nextItemsById });
  },

  setRestoringHistoryId: (restoringHistoryId) => {
    if (get().restoringHistoryId === restoringHistoryId) return;

    set({ restoringHistoryId });
  },
});

export const createStore = () => createWithEqualityFn(subscribeWithSelector(store), shallow);

export const {
  Provider,
  useStore: useHistoryItemsStore,
  useStoreApi: useHistoryItemsStoreApi,
} = createContext<StoreApiWithSelector<Store>>();

export const historyItemSelectors = {
  isRestoring: (historyId: string) => (s: Store) => s.restoringHistoryId === historyId,
  itemById: (historyId: string) => (s: Store) => s.itemsById[historyId],
};

interface HistoryItemsStoreUpdaterProps {
  items: DocumentHistoryListItem[];
  restoringHistoryId: string | null;
}

const HistoryItemsStoreUpdater = memo<HistoryItemsStoreUpdaterProps>(
  ({ items, restoringHistoryId }) => {
    const storeApi = useHistoryItemsStoreApi();

    useLayoutEffect(() => {
      storeApi.getState().setHistoryItems(items);
    }, [items, storeApi]);

    useLayoutEffect(() => {
      storeApi.getState().setRestoringHistoryId(restoringHistoryId);
    }, [restoringHistoryId, storeApi]);

    return null;
  },
);

interface HistoryItemsProviderProps extends PropsWithChildren {
  items: DocumentHistoryListItem[];
  restoringHistoryId: string | null;
}

export const HistoryItemsProvider = memo<HistoryItemsProviderProps>(
  ({ children, items, restoringHistoryId }) => {
    return (
      <Provider createStore={createStore}>
        <HistoryItemsStoreUpdater items={items} restoringHistoryId={restoringHistoryId} />
        {children}
      </Provider>
    );
  },
);
