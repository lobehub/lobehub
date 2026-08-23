import { describe, expect, it } from 'vitest';

import type { TaskGroupItem, TaskListItem } from '@/store/task/slices/list/initialState';

import {
  buildKanbanColumns,
  getKanbanTaskPatch,
  moveTaskBetweenKanbanGroups,
  normalizeKanbanGroupBy,
} from './kanbanBoardModel';

const task = (id: string, assigneeAgentId?: string | null): TaskListItem =>
  ({
    assigneeAgentId,
    id,
    identifier: `T-${id}`,
    priority: 0,
    status: 'backlog',
  }) as TaskListItem;

const group = (
  key: string,
  tasks: TaskListItem[],
  assigneeAgentId?: string | null,
): TaskGroupItem =>
  ({
    assigneeAgentId,
    hasMore: false,
    key,
    limit: 50,
    offset: 0,
    tasks,
    total: tasks.length,
  }) as TaskGroupItem;

describe('kanbanBoardModel', () => {
  it('uses assignee and priority as board dimensions and falls back from no grouping', () => {
    expect(normalizeKanbanGroupBy('assignee')).toBe('assignee');
    expect(normalizeKanbanGroupBy('priority')).toBe('priority');
    expect(normalizeKanbanGroupBy('none')).toBe('status');
  });

  it('builds assignee columns including the unassigned group', () => {
    const groups = [
      group('assignee:agent-1', [task('1', 'agent-1')], 'agent-1'),
      group('assignee:unassigned', [task('2', null)], null),
    ];

    const columns = buildKanbanColumns(groups, 'assignee');

    expect(columns.map((column) => column.key).sort()).toEqual(
      ['assignee:unassigned', 'assignee:agent-1'].sort(),
    );
    expect(
      columns.find((column) => column.key === 'assignee:unassigned')?.groupMeta?.assigneeId,
    ).toBeUndefined();
    expect(columns.find((column) => column.key === 'assignee:agent-1')?.groupMeta?.assigneeId).toBe(
      'agent-1',
    );
  });

  it('patches the task assignee when moving between assignee columns', () => {
    const assignedTask = task('1', 'agent-1');
    const groups = [
      group('assignee:agent-1', [assignedTask], 'agent-1'),
      group('assignee:unassigned', [], null),
    ];
    const targetColumn = buildKanbanColumns(groups, 'assignee').find(
      (column) => column.key === 'assignee:unassigned',
    )!;
    const patch = getKanbanTaskPatch('assignee', targetColumn)!;

    const next = moveTaskBetweenKanbanGroups(groups, assignedTask, targetColumn.key, patch);

    expect(next.find((item) => item.key === 'assignee:agent-1')?.total).toBe(0);
    const unassigned = next.find((item) => item.key === 'assignee:unassigned');
    expect(unassigned?.total).toBe(1);
    expect(unassigned?.tasks[0].assigneeAgentId).toBeNull();
  });

  it('preserves paginated group totals during an optimistic move', () => {
    const assignedTask = task('1', 'agent-1');
    const groups = [
      { ...group('assignee:agent-1', [assignedTask], 'agent-1'), total: 75 },
      { ...group('assignee:agent-2', [], 'agent-2'), total: 63 },
    ];

    const next = moveTaskBetweenKanbanGroups(groups, assignedTask, 'assignee:agent-2', {
      assigneeAgentId: 'agent-2',
    });

    expect(next.map(({ total }) => total)).toEqual([74, 64]);
  });
});
