import { beforeEach, describe, expect, it } from 'vitest';

import { type ProjectListItem, useProjectStore } from '@/store/project';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import type { TaskGroupMeta, TaskRow } from './listViewOptions';
import { groupTaskItems } from './listViewOptions';
import {
  flattenTaskListEntries,
  taskGroupCollapseKey,
  type TaskListGroupEntry,
  taskSubGroupCollapseKey,
} from './taskListVirtualModel';

const meta = (key: string): TaskGroupMeta => ({ groupBy: 'status', key, label: key });

const row = (identifier: string, depth = 0, isParentContext = false): TaskRow =>
  ({ depth, isParentContext, task: { identifier } }) as TaskRow;

const entry = (
  key: string,
  rows: TaskRow[],
  subGroups: TaskListGroupEntry['subGroups'] = [],
): TaskListGroupEntry => ({ count: rows.length, meta: meta(key), rows, subGroups });

describe('flattenTaskListEntries', () => {
  it('lays out header + rows per group and marks the divider between top-level tasks', () => {
    const items = flattenTaskListEntries(
      [entry('running', [row('T-1'), row('T-2', 1), row('T-3')]), entry('backlog', [row('T-4')])],
      { collapsed: new Set(), grouped: true },
    );

    expect(items.map((item) => item.kind)).toEqual(['group', 'row', 'row', 'row', 'group', 'row']);
    expect(items[0]).toMatchObject({ first: true, key: 'group:running', collapsed: false });
    expect(items[4]).toMatchObject({ first: false, key: 'group:backlog' });
    // T-1 is followed by its nested child: no rule. T-2 (child) → T-3 (top level): rule.
    expect(items.slice(1, 4).map((item) => item.kind === 'row' && item.showDivider)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('keeps a collapsed group header but drops its rows and sub-group headers', () => {
    const items = flattenTaskListEntries(
      [
        entry('running', [row('T-1')], [{ count: 1, meta: meta('p1'), rows: [row('T-1')] }]),
        entry('backlog', [row('T-2')]),
      ],
      { collapsed: new Set([taskGroupCollapseKey('running')]), grouped: true },
    );

    expect(items.map((item) => item.key)).toEqual([
      'group:running',
      'group:backlog',
      'backlog:T-2',
    ]);
    expect(items[0]).toMatchObject({ collapsed: true });
  });

  it('renders sub-group headers with their rows marked as sub rows and no dividers', () => {
    const items = flattenTaskListEntries(
      [
        entry(
          'running',
          [row('T-1'), row('T-2')],
          [
            { count: 1, meta: meta('p1'), rows: [row('T-1')] },
            { count: 1, meta: meta('p2'), rows: [row('T-2')] },
          ],
        ),
      ],
      { collapsed: new Set([taskSubGroupCollapseKey('running', 'p2')]), grouped: true },
    );

    expect(items.map((item) => item.key)).toEqual([
      'group:running',
      'sub:running:p1',
      'sub:running:p1:T-1',
      'sub:running:p2',
    ]);
    expect(items[1]).toMatchObject({ first: true, collapsed: false });
    expect(items[2]).toMatchObject({ sub: true, showDivider: false });
    expect(items[3]).toMatchObject({ first: false, collapsed: true });
  });

  it('emits rows only for an ungrouped list', () => {
    const items = flattenTaskListEntries([entry('all', [row('T-1'), row('T-2')])], {
      collapsed: new Set(),
      grouped: false,
    });

    expect(items.map((item) => item.kind)).toEqual(['row', 'row']);
    expect(items[0]).toMatchObject({ showDivider: true });
  });

  it('keys a parent-context row apart from the same task listed as a member', () => {
    const items = flattenTaskListEntries(
      [entry('running', [row('T-1', 0, true), row('T-2', 1)]), entry('backlog', [row('T-1')])],
      { collapsed: new Set(), grouped: true },
    );

    const keys = items.filter((item) => item.kind === 'row').map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('running:context:T-1');
    expect(keys).toContain('backlog:T-1');
  });
});

describe('flattenTaskListEntries grouped by project', () => {
  const task = (identifier: string, projectId?: string | null) =>
    ({ id: identifier, identifier, projectId }) as unknown as TaskListItem;

  const entries = (items: TaskListItem[]): TaskListGroupEntry[] =>
    groupTaskItems(items, 'project').map(([groupMeta, groupItems]) => ({
      count: groupItems.length,
      meta: groupMeta,
      rows: groupItems.map((item) => ({ depth: 0, isParentContext: false, task: item })),
      subGroups: [],
    }));

  beforeEach(() => {
    useProjectStore.setState({
      projectListMap: {
        all: [
          { id: 'proj_b', name: 'Beta' },
          { id: 'proj_a', name: 'Alpha' },
        ] as ProjectListItem[],
      },
    });
  });

  it('lays out a header per project, sorted by name, with "No project" last', () => {
    const items = flattenTaskListEntries(
      entries([
        task('T-1', 'proj_b'),
        task('T-2', null),
        task('T-3', 'proj_a'),
        task('T-4', 'proj_b'),
      ]),
      { collapsed: new Set(), grouped: true },
    );

    expect(items.map((item) => item.key)).toEqual([
      'group:project:proj_a',
      'project:proj_a:T-3',
      'group:project:proj_b',
      'project:proj_b:T-1',
      'project:proj_b:T-4',
      'group:project:none',
      'project:none:T-2',
    ]);
    expect(items[0]).toMatchObject({ count: 1, first: true, meta: { label: 'Alpha' } });
    expect(items[5]).toMatchObject({ count: 1, meta: { groupBy: 'project', projectId: null } });
  });

  it('separates tasks under an unseen project from tasks with no project', () => {
    const items = flattenTaskListEntries(
      entries([task('T-1', undefined), task('T-2', 'gone'), task('T-3', null)]),
      { collapsed: new Set(), grouped: true },
    );

    expect(items.map((item) => item.key)).toEqual([
      'group:project:unavailable',
      'project:unavailable:T-2',
      'group:project:none',
      'project:none:T-1',
      'project:none:T-3',
    ]);
    expect(JSON.stringify(items[0])).not.toContain('gone');
  });

  it('drops the rows of a collapsed project group', () => {
    const items = flattenTaskListEntries(entries([task('T-1', 'proj_a'), task('T-2', null)]), {
      collapsed: new Set([taskGroupCollapseKey('project:proj_a')]),
      grouped: true,
    });

    expect(items.map((item) => item.key)).toEqual([
      'group:project:proj_a',
      'group:project:none',
      'project:none:T-2',
    ]);
  });
});
