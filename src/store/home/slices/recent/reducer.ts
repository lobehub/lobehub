import type { RecentItem } from '@lobechat/types';

import type { RecentEntityRef, RecentScopeState, RecentState } from './initialState';

interface RecentTitleAction {
  entityType: RecentItem['type'];
  id: string;
  mutationId: number;
  scope: string;
}

export type RecentDispatchAction =
  | (RecentTitleAction & { title: string; type: 'commitTitle' | 'setOptimisticTitle' })
  | (RecentTitleAction & { type: 'rollbackTitle' })
  | {
      items: RecentItem[];
      queryKey: string;
      scope: string;
      type: 'replaceQuery';
      updatedAt: number;
    };

const createScopeState = (): RecentScopeState => ({ optimisticTitles: {}, queries: {} });

const updateRecentTitle = (
  items: RecentItem[],
  entityType: RecentItem['type'],
  id: string,
  title: string,
) => {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.type !== entityType || item.id !== id || item.title === title) return item;
    changed = true;
    return { ...item, title };
  });

  return changed ? nextItems : items;
};

export const recentReducer = (
  state: RecentState,
  action: RecentDispatchAction,
): Pick<RecentState, 'recentsByScope'> => {
  const scopedState = state.recentsByScope[action.scope];

  switch (action.type) {
    case 'commitTitle': {
      if (!scopedState) return { recentsByScope: state.recentsByScope };

      const ref = `${action.entityType}:${action.id}` as RecentEntityRef;
      const optimisticTitles = { ...scopedState.optimisticTitles };
      if (optimisticTitles[ref]?.mutationId === action.mutationId) delete optimisticTitles[ref];

      const queries = Object.fromEntries(
        Object.entries(scopedState.queries).map(([queryKey, query]) => {
          const items = updateRecentTitle(query.items, action.entityType, action.id, action.title);
          return [queryKey, items === query.items ? query : { ...query, items }];
        }),
      );

      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: { ...scopedState, optimisticTitles, queries },
        },
      };
    }

    case 'replaceQuery': {
      const currentScope = scopedState ?? createScopeState();
      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: {
            ...currentScope,
            queries: {
              ...currentScope.queries,
              [action.queryKey]: { items: action.items, updatedAt: action.updatedAt },
            },
          },
        },
      };
    }

    case 'rollbackTitle': {
      const ref = `${action.entityType}:${action.id}` as RecentEntityRef;
      if (!scopedState || scopedState.optimisticTitles[ref]?.mutationId !== action.mutationId) {
        return { recentsByScope: state.recentsByScope };
      }

      const optimisticTitles = { ...scopedState.optimisticTitles };
      delete optimisticTitles[ref];
      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: { ...scopedState, optimisticTitles },
        },
      };
    }

    case 'setOptimisticTitle': {
      const currentScope = scopedState ?? createScopeState();
      const ref = `${action.entityType}:${action.id}` as RecentEntityRef;
      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: {
            ...currentScope,
            optimisticTitles: {
              ...currentScope.optimisticTitles,
              [ref]: { mutationId: action.mutationId, title: action.title },
            },
          },
        },
      };
    }
  }
};
