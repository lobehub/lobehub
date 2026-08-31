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
  | { queryKey: string; scope: string; type: 'failHydration' | 'finishHydration' }
  | { error: unknown; queryKey: string; scope: string; type: 'failSync' }
  | {
      items: RecentItem[];
      queryKey: string;
      scope: string;
      type: 'hydrateQuery';
      updatedAt: number;
    }
  | {
      items: RecentItem[];
      queryKey: string;
      scope: string;
      type: 'replaceQuery';
      updatedAt: number;
    }
  | { queryKey: string; scope: string; type: 'startHydration' | 'startSync' }
  | { queryKey: string; scope: string; type: 'finishSync' };

const createScopeState = (): RecentScopeState => ({
  hydrationStatusByQuery: {},
  optimisticTitles: {},
  queries: {},
  syncStatusByQuery: {},
});

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

    case 'failHydration':
    case 'finishHydration':
    case 'startHydration': {
      const currentScope = scopedState ?? createScopeState();
      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: {
            ...currentScope,
            hydrationStatusByQuery: {
              ...currentScope.hydrationStatusByQuery,
              [action.queryKey]:
                action.type === 'startHydration'
                  ? 'hydrating'
                  : action.type === 'finishHydration'
                    ? 'hydrated'
                    : 'failed',
            },
          },
        },
      };
    }

    case 'failSync':
    case 'finishSync':
    case 'startSync': {
      const currentScope = scopedState ?? createScopeState();
      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: {
            ...currentScope,
            syncStatusByQuery: {
              ...currentScope.syncStatusByQuery,
              [action.queryKey]: {
                error: action.type === 'failSync' ? action.error : undefined,
                isValidating: action.type === 'startSync',
              },
            },
          },
        },
      };
    }

    case 'hydrateQuery': {
      const currentScope = scopedState ?? createScopeState();
      const currentQuery = currentScope.queries[action.queryKey];
      const queries =
        currentQuery?.source === 'server'
          ? currentScope.queries
          : {
              ...currentScope.queries,
              [action.queryKey]: {
                items: action.items,
                source: 'storage' as const,
                updatedAt: action.updatedAt,
              },
            };

      return {
        recentsByScope: {
          ...state.recentsByScope,
          [action.scope]: {
            ...currentScope,
            hydrationStatusByQuery: {
              ...currentScope.hydrationStatusByQuery,
              [action.queryKey]: 'hydrated',
            },
            queries,
          },
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
              [action.queryKey]: {
                items: action.items,
                source: 'server',
                updatedAt: action.updatedAt,
              },
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
