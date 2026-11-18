import { TASK_LIST_FILTER_MAX_VALUES } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  MAX_STORED_TASK_LIST_FILTERS,
  pickOfferedTaskFilter,
  removeTaskFilterField,
  setTaskFilterContent,
  setTaskFilterDateWindow,
  showsTaskFilterValuesInline,
  taskFilterBarConditions,
  taskFilterSetOperatorKey,
  taskListFilterScopeKey,
  toggleTaskFilterOperator,
  toggleTaskFilterValue,
  upsertTaskListFilterEntry,
} from './taskFilterState';

describe('taskListFilterScopeKey', () => {
  it('keys filters by workspace and page scope', () => {
    expect(taskListFilterScopeKey({})).toBe('personal:global');
    expect(taskListFilterScopeKey({ workspaceId: 'ws_1' })).toBe('ws_1:global');
    expect(taskListFilterScopeKey({ agentId: 'agt_1', workspaceId: 'ws_1' })).toBe(
      'ws_1:agent:agt_1',
    );
    // A project page is scoped by the project even when an agent is known.
    expect(taskListFilterScopeKey({ agentId: 'agt_1', projectId: 'proj_1' })).toBe(
      'personal:project:proj_1',
    );
  });
});

describe('upsertTaskListFilterEntry', () => {
  it('adds, replaces and removes a scope entry', () => {
    const added = upsertTaskListFilterEntry([], 'a', {
      status: { operator: 'is', values: ['backlog'] },
    });
    expect(added).toEqual([
      { filter: { status: { operator: 'is', values: ['backlog'] } }, scope: 'a' },
    ]);

    const replaced = upsertTaskListFilterEntry(added, 'a', { content: 'x' });
    expect(replaced).toEqual([{ filter: { content: 'x' }, scope: 'a' }]);

    expect(upsertTaskListFilterEntry(replaced, 'a', undefined)).toEqual([]);
    expect(upsertTaskListFilterEntry(replaced, 'a', {})).toEqual([]);
  });

  it('keeps only the most recently touched scopes', () => {
    let entries = upsertTaskListFilterEntry([], 'first', { content: 'x' });
    for (let i = 0; i < MAX_STORED_TASK_LIST_FILTERS; i++) {
      entries = upsertTaskListFilterEntry(entries, `scope-${i}`, { content: 'x' });
    }
    expect(entries).toHaveLength(MAX_STORED_TASK_LIST_FILTERS);
    expect(entries.some((entry) => entry.scope === 'first')).toBe(false);
  });
});

describe('filter editing', () => {
  it('toggles values in and out, starting a new condition as "is"', () => {
    const one = toggleTaskFilterValue(undefined, 'status', 'running');
    expect(one).toEqual({ status: { operator: 'is', values: ['running'] } });

    const two = toggleTaskFilterValue(one, 'status', 'backlog');
    expect(two).toEqual({ status: { operator: 'is', values: ['backlog', 'running'] } });

    expect(
      toggleTaskFilterValue(toggleTaskFilterValue(two, 'status', 'backlog'), 'status', 'running'),
    ).toBeUndefined();
  });

  it('stops adding values at the list query limit but still removes them', () => {
    const values = Array.from({ length: TASK_LIST_FILTER_MAX_VALUES }, (_, i) => `agt_${i}`);
    const full = { agent: { operator: 'is' as const, values } };
    expect(toggleTaskFilterValue(full, 'agent', 'agt_extra')).toBe(full);
    expect(toggleTaskFilterValue(full, 'agent', 'agt_0')?.agent?.values).toHaveLength(
      TASK_LIST_FILTER_MAX_VALUES - 1,
    );
  });

  it('keeps the operator when values change', () => {
    const negated = toggleTaskFilterOperator(
      toggleTaskFilterValue(undefined, 'priority', 1),
      'priority',
    );
    expect(toggleTaskFilterValue(negated, 'priority', 2)).toEqual({
      priority: { operator: 'isNot', values: [1, 2] },
    });
  });

  it('flips date operators and keeps them when the window changes', () => {
    const within = setTaskFilterDateWindow(undefined, 'createdAt', 'week');
    expect(within).toEqual({ createdAt: { operator: 'within', window: 'week' } });

    const before = toggleTaskFilterOperator(within, 'createdAt');
    expect(setTaskFilterDateWindow(before, 'createdAt', 'month')).toEqual({
      createdAt: { operator: 'before', window: 'month' },
    });
  });

  it('sets and clears content', () => {
    expect(setTaskFilterContent(undefined, ' menu ')).toEqual({ content: 'menu' });
    expect(setTaskFilterContent({ content: 'menu' }, '')).toBeUndefined();
  });

  it('removes one field and leaves the rest', () => {
    expect(
      removeTaskFilterField(
        { content: 'menu', status: { operator: 'is', values: ['backlog'] } },
        'status',
      ),
    ).toEqual({ content: 'menu' });
  });
});

describe('pickOfferedTaskFilter', () => {
  it('drops conditions on fields the page does not offer, keeping content', () => {
    expect(
      pickOfferedTaskFilter(
        {
          assignee: { operator: 'is', values: ['user_1'] },
          content: 'menu',
          status: { operator: 'is', values: ['backlog'] },
        },
        ['status', 'priority'],
      ),
    ).toEqual({ content: 'menu', status: { operator: 'is', values: ['backlog'] } });
  });

  it('returns undefined when nothing offered is left', () => {
    expect(
      pickOfferedTaskFilter({ assignee: { operator: 'is', values: ['user_1'] } }, ['status']),
    ).toBeUndefined();
  });
});

describe('set chip display', () => {
  it('reads the operator as plural once several values are picked', () => {
    expect(taskFilterSetOperatorKey('is', 1)).toBe('taskList.filter.operator.is');
    expect(taskFilterSetOperatorKey('is', 2)).toBe('taskList.filter.operator.isAnyOf');
    expect(taskFilterSetOperatorKey('isNot', 1)).toBe('taskList.filter.operator.isNot');
    expect(taskFilterSetOperatorKey('isNot', 3)).toBe('taskList.filter.operator.isNoneOf');
  });

  it('lists up to two values inline and collapses more into a count', () => {
    expect(showsTaskFilterValuesInline(2)).toBe(true);
    expect(showsTaskFilterValuesInline(3)).toBe(false);
  });
});

describe('taskFilterBarConditions', () => {
  const status = { operator: 'is' as const, values: ['running'] };

  it('keeps every condition when the header has no find box', () => {
    expect(taskFilterBarConditions({ content: 'deploy' }, false)).toEqual({ content: 'deploy' });
  });

  it('leaves the content condition to the find box', () => {
    expect(taskFilterBarConditions({ content: 'deploy', status }, true)).toEqual({ status });
  });

  it('has nothing to render when the find box holds the only condition', () => {
    expect(taskFilterBarConditions({ content: 'deploy' }, true)).toBeUndefined();
    expect(taskFilterBarConditions(undefined, true)).toBeUndefined();
  });
});
