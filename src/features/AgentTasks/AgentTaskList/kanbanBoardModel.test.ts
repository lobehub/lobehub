import { describe, expect, it } from 'vitest';

import type { TaskGroupItem, TaskListItem } from '@/store/task/slices/list/initialState';

import {
  buildKanbanColumns,
  canDropTaskIntoKanbanColumn,
  getKanbanAssigneeUpdate,
  getKanbanTaskPatch,
  moveTaskBetweenKanbanGroups,
  normalizeKanbanGroupBy,
} from './kanbanBoardModel';

const task = (
  id: string,
  assigneeAgentId?: string | null,
  assigneeUserId?: string | null,
  overrides: Partial<TaskListItem> = {},
): TaskListItem =>
  ({
    assigneeAgentId,
    assigneeUserId,
    automationMode: null,
    createdByUserId: 'creator-1',
    id,
    identifier: `T-${id}`,
    priority: 0,
    status: 'backlog',
    visibility: 'public',
    ...overrides,
  }) as TaskListItem;

const group = (
  key: string,
  tasks: TaskListItem[],
  assigneeAgentId?: string | null,
  assigneeUserId?: string | null,
): TaskGroupItem =>
  ({
    assigneeAgentId,
    assigneeUserId,
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
      group('assignee:user:user-1', [task('3', null, 'user-1')], undefined, 'user-1'),
    ];

    const columns = buildKanbanColumns(groups, 'assignee');

    expect(columns.map((column) => column.key).sort()).toEqual(
      ['assignee:unassigned', 'assignee:agent-1', 'assignee:user:user-1'].sort(),
    );
    expect(
      columns.find((column) => column.key === 'assignee:unassigned')?.groupMeta?.assigneeId,
    ).toBeUndefined();
    expect(columns.find((column) => column.key === 'assignee:agent-1')?.groupMeta?.assigneeId).toBe(
      'agent-1',
    );
    expect(
      columns.find((column) => column.key === 'assignee:user:user-1')?.groupMeta?.assigneeUserId,
    ).toBe('user-1');
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
    expect(unassigned?.tasks[0].assigneeUserId).toBeNull();
  });

  it('persists both assignee fields when moving between agent and member columns', () => {
    expect(
      getKanbanAssigneeUpdate(task('1', null, 'user-1'), {
        assigneeAgentId: 'agent-1',
        assigneeUserId: null,
      }),
    ).toEqual({ assigneeAgentId: 'agent-1', assigneeUserId: null });
    expect(
      getKanbanAssigneeUpdate(task('2', 'agent-1'), {
        assigneeAgentId: null,
        assigneeUserId: 'user-1',
      }),
    ).toEqual({ assigneeAgentId: null, assigneeUserId: 'user-1' });
    expect(
      getKanbanAssigneeUpdate(task('3', null, 'user-1'), {
        assigneeAgentId: null,
        assigneeUserId: 'user-1',
      }),
    ).toBeUndefined();
  });

  it('rejects member-column drops for automated tasks', () => {
    const columns = buildKanbanColumns(
      [
        group('assignee:agent-1', [], 'agent-1'),
        group('assignee:user:user-1', [], undefined, 'user-1'),
      ],
      'assignee',
    );
    const agentColumn = columns.find((column) => column.key === 'assignee:agent-1')!;
    const memberColumn = columns.find((column) => column.key === 'assignee:user:user-1')!;
    const automatedTask = task('automated', null, null, { automationMode: 'schedule' });

    expect(canDropTaskIntoKanbanColumn(automatedTask, 'assignee', memberColumn)).toBe(false);
    expect(canDropTaskIntoKanbanColumn(automatedTask, 'assignee', agentColumn)).toBe(true);
  });

  it('only allows private tasks to be dropped into their creator member column', () => {
    const columns = buildKanbanColumns(
      [
        group('assignee:user:creator-1', [], undefined, 'creator-1'),
        group('assignee:user:user-2', [], undefined, 'user-2'),
      ],
      'assignee',
    );
    const creatorColumn = columns.find((column) => column.key === 'assignee:user:creator-1')!;
    const otherMemberColumn = columns.find((column) => column.key === 'assignee:user:user-2')!;
    const privateTask = task('private', null, null, { visibility: 'private' });

    expect(canDropTaskIntoKanbanColumn(privateTask, 'assignee', creatorColumn)).toBe(true);
    expect(canDropTaskIntoKanbanColumn(privateTask, 'assignee', otherMemberColumn)).toBe(false);
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
