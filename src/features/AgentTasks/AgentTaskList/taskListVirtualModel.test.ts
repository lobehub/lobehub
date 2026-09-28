import { describe, expect, it } from 'vitest';

import type { TaskGroupMeta, TaskRow } from './listViewOptions';
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
