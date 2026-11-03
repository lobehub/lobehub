import { describe, expect, it } from 'vitest';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import {
  buildTaskRows,
  collapseSubTasks,
  compareTaskItems,
  DEFAULT_TASK_LIST_VIEW_OPTIONS,
  getCompletedWithin,
  getVisibleTaskStatuses,
  groupTaskItems,
  HIDDEN_WHEN_COMPLETED_STATUSES,
  isTaskHiddenByCompletedFilter,
  normalizeTaskListViewOptions,
  toStoredTaskListViewOptions,
} from './listViewOptions';

const task = (id: string, overrides: Partial<TaskListItem> = {}): TaskListItem =>
  ({
    createdAt: new Date('2026-01-01'),
    id,
    identifier: `T-${id}`,
    name: id,
    parentTaskId: null,
    priority: 0,
    status: 'backlog',
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as unknown as TaskListItem;

const byIdentifier = (a: TaskListItem, b: TaskListItem) => a.identifier.localeCompare(b.identifier);

const indexById = (items: TaskListItem[]) => new Map(items.map((item) => [item.id, item]));

describe('normalizeTaskListViewOptions', () => {
  it('keeps sub-tasks out of the list but nested by default', () => {
    const options = normalizeTaskListViewOptions();

    expect(options.showSubTasks).toBe(false);
    expect(options.nestedSubTasks).toBe(true);
  });

  it('restores the sub-task defaults for options persisted before the toggles existed', () => {
    const options = normalizeTaskListViewOptions({ groupBy: 'priority' });

    expect(options.showSubTasks).toBe(DEFAULT_TASK_LIST_VIEW_OPTIONS.showSubTasks);
    expect(options.nestedSubTasks).toBe(DEFAULT_TASK_LIST_VIEW_OPTIONS.nestedSubTasks);
  });

  it('hides archived tasks by default and keeps an explicit choice', () => {
    expect(normalizeTaskListViewOptions().showArchived).toBe(false);
    expect(normalizeTaskListViewOptions({ groupBy: 'priority' }).showArchived).toBe(false);
    expect(normalizeTaskListViewOptions({ showArchived: true }).showArchived).toBe(true);
  });

  it('preserves an explicit sub-task choice', () => {
    const options = normalizeTaskListViewOptions({ nestedSubTasks: false, showSubTasks: true });

    expect(options.showSubTasks).toBe(true);
    expect(options.nestedSubTasks).toBe(false);
  });
});

describe('automation mode grouping', () => {
  it('groups scheduled and heartbeat tasks separately with schedule first', () => {
    const schedule = task('schedule', { automationMode: 'schedule' });
    const heartbeat = task('heartbeat', { automationMode: 'heartbeat' });
    expect(
      groupTaskItems([heartbeat, schedule], 'automationMode').map(([group, items]) => [
        group.automationMode,
        items.map((item) => item.id),
      ]),
    ).toEqual([
      ['schedule', ['schedule']],
      ['heartbeat', ['heartbeat']],
    ]);
  });

  it('does not create an empty automation group', () => {
    const heartbeat = task('heartbeat', { automationMode: 'heartbeat' });
    const groups = groupTaskItems([heartbeat], 'automationMode');

    expect(groups.map(([group]) => group.key)).toEqual(['automationMode:heartbeat']);
  });
});

describe('assignment grouping', () => {
  it('groups agent and member assignments independently', () => {
    const dualAssigned = task('dual', {
      assigneeAgentId: 'agent-1',
      assigneeUserId: 'user-1',
    });
    const memberOnly = task('member-only', { assigneeUserId: 'user-1' });

    expect(
      groupTaskItems([dualAssigned, memberOnly], 'assignee').map(([group, items]) => [
        group.key,
        items.map((item) => item.id),
      ]),
    ).toEqual([
      ['assignee:agent-1', ['dual']],
      ['assignee:unassigned', ['member-only']],
    ]);
    expect(
      groupTaskItems([dualAssigned, memberOnly], 'member').map(([group, items]) => [
        group.key,
        items.map((item) => item.id),
      ]),
    ).toEqual([['member:user-1', ['dual', 'member-only']]]);
  });
});

describe('collapseSubTasks', () => {
  it('drops a sub-task whose parent is already listed', () => {
    const items = [task('parent'), task('child', { parentTaskId: 'parent' })];

    expect(collapseSubTasks(items).map((item) => item.id)).toEqual(['parent']);
  });

  it('drops every level of a nested chain the root stands for', () => {
    const items = [
      task('root'),
      task('child', { parentTaskId: 'root' }),
      task('grandchild', { parentTaskId: 'child' }),
    ];

    expect(collapseSubTasks(items).map((item) => item.id)).toEqual(['root']);
  });

  it('keeps a sub-task whose parent is absent from the list', () => {
    // A goal's child: the parent is filtered out server-side, so no listed row
    // stands for it and hiding it would drop it from the page entirely.
    const items = [task('orphan', { parentTaskId: 'goal-task' }), task('solo')];

    expect(collapseSubTasks(items).map((item) => item.id)).toEqual(['orphan', 'solo']);
  });
});

describe('buildTaskRows', () => {
  it('leaves every task at the top level when nesting is off', () => {
    const items = [task('parent'), task('child', { parentTaskId: 'parent' })];
    const rows = buildTaskRows(items, {
      compare: byIdentifier,
      nested: false,
      taskById: indexById(items),
    });

    expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
      ['parent', 0],
      ['child', 0],
    ]);
  });

  it('indents a sub-task under the parent it shares a group with', () => {
    const items = [
      task('child', { parentTaskId: 'parent' }),
      task('parent'),
      task('grandchild', { parentTaskId: 'child' }),
    ];
    const rows = buildTaskRows(items, {
      compare: byIdentifier,
      nested: true,
      taskById: indexById(items),
    });

    expect(rows.map((row) => [row.task.id, row.depth, row.isParentContext])).toEqual([
      ['parent', 0, false],
      ['child', 1, false],
      ['grandchild', 2, false],
    ]);
  });

  it('anchors a sub-task under a muted context row when its parent sits elsewhere', () => {
    const parent = task('parent', { status: 'backlog' });
    const child = task('child', { parentTaskId: 'parent', status: 'running' });
    const rows = buildTaskRows([child], {
      compare: byIdentifier,
      nested: true,
      taskById: indexById([parent, child]),
    });

    expect(rows.map((row) => [row.task.id, row.depth, row.isParentContext])).toEqual([
      ['parent', 0, true],
      ['child', 1, false],
    ]);
  });

  it('gathers siblings from other groups under a single context row', () => {
    const parent = task('parent');
    const first = task('first', { parentTaskId: 'parent' });
    const second = task('second', { parentTaskId: 'parent' });
    const rows = buildTaskRows([second, first], {
      compare: byIdentifier,
      nested: true,
      taskById: indexById([parent, first, second]),
    });

    expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
      ['parent', 0],
      ['first', 1],
      ['second', 1],
    ]);
  });

  it('keeps a sub-task at the top level when its parent is off the list entirely', () => {
    const orphan = task('orphan', { parentTaskId: 'missing' });
    const rows = buildTaskRows([orphan], {
      compare: byIdentifier,
      nested: true,
      taskById: indexById([orphan]),
    });

    expect(rows).toEqual([{ depth: 0, isParentContext: false, task: orphan }]);
  });

  it('renders every task once when the parent chain loops back on itself', () => {
    const a = task('a', { parentTaskId: 'b' });
    const b = task('b', { parentTaskId: 'a' });
    const rows = buildTaskRows([a, b], {
      compare: byIdentifier,
      nested: true,
      taskById: indexById([a, b]),
    });

    expect(rows.map((row) => row.task.id).sort()).toEqual(['a', 'b']);
  });

  it('orders siblings with the list comparator', () => {
    const options = { ...DEFAULT_TASK_LIST_VIEW_OPTIONS, orderBy: 'title' as const };
    const parent = task('parent', { name: 'A parent' });
    const beta = task('beta', { name: 'Beta', parentTaskId: 'parent' });
    const alpha = task('alpha', { name: 'Alpha', parentTaskId: 'parent' });
    const rows = buildTaskRows([parent, beta, alpha], {
      compare: (a, b) => compareTaskItems(a, b, options),
      nested: true,
      taskById: indexById([parent, beta, alpha]),
    });

    expect(rows.map((row) => row.task.id)).toEqual(['parent', 'alpha', 'beta']);
  });
});

describe('completedTasks', () => {
  it('defaults to hiding completed and canceled tasks', () => {
    expect(normalizeTaskListViewOptions().completedTasks).toBe('none');
  });

  it('migrates the persisted hideCompleted switch it replaces', () => {
    expect(normalizeTaskListViewOptions({ hideCompleted: true }).completedTasks).toBe('none');
    expect(normalizeTaskListViewOptions({ hideCompleted: false }).completedTasks).toBe('all');
  });

  it('prefers a stored completedTasks over a leftover hideCompleted', () => {
    expect(
      normalizeTaskListViewOptions({ completedTasks: 'week', hideCompleted: true }).completedTasks,
    ).toBe('week');
  });

  it('falls back to the default for an unknown value', () => {
    expect(normalizeTaskListViewOptions({ completedTasks: 'year' as never }).completedTasks).toBe(
      'none',
    );
  });
});

describe('toStoredTaskListViewOptions', () => {
  it('keeps the legacy hideCompleted in step for builds that only read it', () => {
    const stored = (completedTasks: TaskListViewOptions['completedTasks']) =>
      toStoredTaskListViewOptions({ ...DEFAULT_TASK_LIST_VIEW_OPTIONS, completedTasks });

    expect(stored('none').hideCompleted).toBe(true);
    expect(stored('all').hideCompleted).toBe(false);
    expect(stored('week').hideCompleted).toBe(false);
  });

  it('round-trips through normalization to the same choice', () => {
    const options = { ...DEFAULT_TASK_LIST_VIEW_OPTIONS, completedTasks: 'month' as const };
    expect(normalizeTaskListViewOptions(toStoredTaskListViewOptions(options))).toEqual(options);
  });
});

describe('isTaskHiddenByCompletedFilter', () => {
  const now = new Date('2026-03-10T12:00:00Z').getTime();
  const closedDaysAgo = (status: TaskListItem['status'], days: number, field = 'completedAt') =>
    task(`${status}-${days}`, {
      status,
      updatedAt: new Date('2026-01-01'),
      [field]: new Date(now - days * 24 * 60 * 60 * 1000),
    } as Partial<TaskListItem>);

  it('never hides an unfinished task, however old', () => {
    const old = task('old', { status: 'backlog', updatedAt: new Date('2020-01-01') });
    expect(isTaskHiddenByCompletedFilter(old, 'none', now)).toBe(false);
    expect(isTaskHiddenByCompletedFilter(old, 'day', now)).toBe(false);
  });

  it('keeps completed tasks closed within the window and hides older ones', () => {
    expect(isTaskHiddenByCompletedFilter(closedDaysAgo('completed', 3), 'week', now)).toBe(false);
    expect(isTaskHiddenByCompletedFilter(closedDaysAgo('completed', 8), 'week', now)).toBe(true);
    expect(isTaskHiddenByCompletedFilter(closedDaysAgo('completed', 2), 'day', now)).toBe(true);
    expect(isTaskHiddenByCompletedFilter(closedDaysAgo('completed', 20), 'month', now)).toBe(false);
  });

  it('dates a canceled task without completedAt by updatedAt', () => {
    const recent = closedDaysAgo('canceled', 1, 'updatedAt');
    expect(isTaskHiddenByCompletedFilter(recent, 'week', now)).toBe(false);
    const stale = closedDaysAgo('canceled', 10, 'updatedAt');
    expect(isTaskHiddenByCompletedFilter(stale, 'week', now)).toBe(true);
  });

  it('shows every closed task for all and none of them for none', () => {
    const ancient = closedDaysAgo('completed', 400);
    expect(isTaskHiddenByCompletedFilter(ancient, 'all', now)).toBe(false);
    expect(isTaskHiddenByCompletedFilter(closedDaysAgo('completed', 0), 'none', now)).toBe(true);
  });
});

describe('getCompletedWithin', () => {
  it('sends only a windowed choice to the server', () => {
    expect(getCompletedWithin({ completedTasks: 'week' })).toBe('week');
    expect(getCompletedWithin({ completedTasks: 'all' })).toBeUndefined();
    expect(getCompletedWithin({ completedTasks: 'none' })).toBeUndefined();
  });
});

describe('getVisibleTaskStatuses', () => {
  it('translates completedTasks none into the server status filter, before pagination', () => {
    const statuses = getVisibleTaskStatuses({ completedTasks: 'none' });
    expect(statuses).toBeDefined();
    for (const hidden of HIDDEN_WHEN_COMPLETED_STATUSES) expect(statuses).not.toContain(hidden);
    expect(statuses).toContain('backlog');
    expect(statuses).toContain('running');
  });

  it('applies no narrowing when completed tasks are shown', () => {
    expect(getVisibleTaskStatuses({ completedTasks: 'all' })).toBeUndefined();
    expect(getVisibleTaskStatuses({ completedTasks: 'week' })).toBeUndefined();
  });
});
