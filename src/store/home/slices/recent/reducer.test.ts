import type { RecentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { RecentState } from './initialState';
import { recentReducer } from './reducer';

const item = (id: string, title: string, type: RecentItem['type'] = 'task'): RecentItem => ({
  icon: type,
  id,
  routePath: '/',
  status: null,
  title,
  type,
  updatedAt: new Date(0),
});

const state = (items: RecentItem[]): RecentState => ({
  allRecentsDrawerOpen: false,
  recentsByScope: {
    scope: {
      hydrationStatusByQuery: {},
      optimisticTitles: {},
      queries: {
        compact: { items, source: 'server', updatedAt: 1 },
        drawer: {
          items: [...items, item('document', 'Document', 'document')],
          source: 'server',
          updatedAt: 1,
        },
      },
      syncStatusByQuery: {},
    },
  },
});

describe('recentReducer', () => {
  it('replaces one query without changing the other projections', () => {
    const current = state([item('task', 'Task')]);
    const next = recentReducer(current, {
      items: [item('new', 'New')],
      queryKey: 'compact',
      scope: 'scope',
      type: 'replaceQuery',
      updatedAt: 2,
    });

    expect(next.recentsByScope.scope.queries.compact).toEqual({
      items: [item('new', 'New')],
      source: 'server',
      updatedAt: 2,
    });
    expect(next.recentsByScope.scope.queries.drawer).toBe(
      current.recentsByScope.scope.queries.drawer,
    );
  });

  it('commits an entity title to every loaded query projection', () => {
    const current = state([item('task', 'Draft')]);
    const optimistic = recentReducer(current, {
      entityType: 'task',
      id: 'task',
      mutationId: 1,
      scope: 'scope',
      title: 'Renamed',
      type: 'setOptimisticTitle',
    });
    const next = recentReducer(
      { ...current, ...optimistic },
      {
        entityType: 'task',
        id: 'task',
        mutationId: 1,
        scope: 'scope',
        title: 'Renamed',
        type: 'commitTitle',
      },
    );

    expect(next.recentsByScope.scope.optimisticTitles).toEqual({});
    expect(next.recentsByScope.scope.queries.compact.items[0].title).toBe('Renamed');
    expect(next.recentsByScope.scope.queries.drawer.items[0].title).toBe('Renamed');
    expect(next.recentsByScope.scope.queries.drawer.items[1].title).toBe('Document');
  });

  it('does not roll back a newer optimistic mutation', () => {
    const current = state([item('task', 'Draft')]);
    const optimistic = recentReducer(current, {
      entityType: 'task',
      id: 'task',
      mutationId: 2,
      scope: 'scope',
      title: 'Latest',
      type: 'setOptimisticTitle',
    });
    const next = recentReducer(
      { ...current, ...optimistic },
      {
        entityType: 'task',
        id: 'task',
        mutationId: 1,
        scope: 'scope',
        type: 'rollbackTitle',
      },
    );

    expect(next.recentsByScope).toBe(optimistic.recentsByScope);
    expect(next.recentsByScope.scope.optimisticTitles['task:task']?.title).toBe('Latest');
  });

  it('does not let late storage hydration overwrite server data', () => {
    const current = state([item('task', 'Server')]);
    const next = recentReducer(current, {
      items: [item('task', 'Cached')],
      queryKey: 'compact',
      scope: 'scope',
      type: 'hydrateQuery',
      updatedAt: 2,
    });

    expect(next.recentsByScope.scope.queries.compact.items[0].title).toBe('Server');
    expect(next.recentsByScope.scope.hydrationStatusByQuery.compact).toBe('hydrated');
  });
});
