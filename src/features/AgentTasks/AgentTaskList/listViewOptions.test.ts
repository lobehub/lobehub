import { describe, expect, it } from 'vitest';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import {
  buildTaskRows,
  collapseSubTasks,
  compareTaskItems,
  DEFAULT_TASK_LIST_VIEW_OPTIONS,
  groupTaskItems,
  normalizeTaskListViewOptions,
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
