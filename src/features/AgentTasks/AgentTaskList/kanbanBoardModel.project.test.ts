import { beforeEach, describe, expect, it } from 'vitest';

import { type ProjectListItem, useProjectStore } from '@/store/project';
import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

import {
  buildKanbanColumns,
  getKanbanColumnCreateDefaults,
  getKanbanCreateTaskModalProps,
  getKanbanTaskPatch,
  getTaskGroupCreateDefaults,
  getTaskSubGroupCreateDefaults,
  mergeUnresolvedProjectGroups,
  normalizeKanbanGroupBy,
} from './kanbanBoardModel';

const projects = [
  { id: 'proj_b', name: 'Beta' },
  { id: 'proj_a', name: 'Alpha' },
] as ProjectListItem[];

const group = (key: string, projectId: string | null, taskIds: string[] = []): TaskGroupItem =>
  ({
    hasMore: false,
    key,
    limit: 50,
    offset: 0,
    projectId,
    tasks: taskIds.map((id) => ({ id, identifier: id, projectId })),
    total: taskIds.length,
  }) as unknown as TaskGroupItem;

beforeEach(() => {
  useProjectStore.setState({ projectListMap: { all: projects } });
});

describe('project board columns', () => {
  it('keeps project as a board dimension', () => {
    expect(normalizeKanbanGroupBy('project')).toBe('project');
  });

  it('builds one named column per project, with "No project" last', () => {
    const columns = buildKanbanColumns(
      [
        group('project:none', null),
        group('project:proj_b', 'proj_b', ['t1']),
        group('project:proj_a', 'proj_a', ['t2']),
      ],
      'project',
    );

    expect(columns.map((column) => column.key)).toEqual([
      'project:proj_a',
      'project:proj_b',
      'project:none',
    ]);
    expect(columns[0].groupMeta).toMatchObject({ label: 'Alpha', projectId: 'proj_a' });
    expect(columns[2].groupMeta).toMatchObject({ groupBy: 'project', projectId: null });
    expect(columns.every((column) => column.droppable)).toBe(true);
  });

  it('never names a column after a project outside the list', () => {
    const columns = buildKanbanColumns(
      mergeUnresolvedProjectGroups(
        [group('project:none', null, ['t0']), group('project:gone', 'gone', ['t1', 't2'])],
        projects,
      ),
      'project',
    );

    expect(columns.map((column) => column.key)).toEqual(['project:unavailable', 'project:none']);
    expect(columns[0].droppable).toBe(false);
    expect(columns[1].droppable).toBe(true);
    expect(JSON.stringify(columns)).not.toContain('gone');
  });
});

describe('mergeUnresolvedProjectGroups', () => {
  it('folds unseen projects into one column, leaving "No project" with only unlinked tasks', () => {
    const merged = mergeUnresolvedProjectGroups(
      [
        group('project:none', null, ['t0']),
        group('project:proj_a', 'proj_a', ['t1']),
        group('project:gone', 'gone', ['t2', 't3']),
        group('project:gone2', 'gone2', ['t4']),
      ],
      projects,
    );
    const byKey = new Map(merged.map((item) => [item.key, item]));

    expect(byKey.get('project:none')?.tasks.map((task) => task.id)).toEqual(['t0']);
    expect(byKey.get('project:none')?.total).toBe(1);
    expect(byKey.get('project:unavailable')?.tasks.map((task) => task.id)).toEqual([
      't2',
      't3',
      't4',
    ]);
    expect(byKey.get('project:unavailable')?.total).toBe(3);
    expect([...byKey.keys()]).not.toContain('project:gone');
  });

  it('keeps tasks of unseen projects on a board with no "No project" column', () => {
    const merged = mergeUnresolvedProjectGroups([group('project:gone', 'gone', ['t1'])], projects);

    expect(merged.map((item) => item.key)).toEqual(['project:unavailable']);
    expect(merged[0].tasks.map((task) => task.id)).toEqual(['t1']);
  });

  it('decides nothing before the list has loaded', () => {
    const groups = [group('project:gone', 'gone', ['t1'])];
    expect(mergeUnresolvedProjectGroups(groups, undefined)).toBe(groups);
  });

  it('returns the same reference when every project is visible', () => {
    const groups = [group('project:none', null), group('project:proj_a', 'proj_a')];
    expect(mergeUnresolvedProjectGroups(groups, projects)).toBe(groups);
  });
});

describe('the "Unavailable project" column', () => {
  it('offers no create entry, since a new task could not land there', () => {
    const [column] = buildKanbanColumns([group('project:gone', 'gone', ['t1'])], 'project');

    expect(column.key).toBe('project:unavailable');
    expect(getKanbanColumnCreateDefaults('project', column)).toBeUndefined();
    expect(getTaskGroupCreateDefaults(column.groupMeta)).toBeUndefined();
  });
});

describe('dropping and creating in a project column', () => {
  const columns = () =>
    buildKanbanColumns(
      [group('project:proj_a', 'proj_a', ['t1']), group('project:none', null)],
      'project',
    );

  it('moves a dropped card into the project, or clears it on "No project"', () => {
    const [named, none] = columns();
    expect(getKanbanTaskPatch('project', named)).toEqual({ projectId: 'proj_a' });
    expect(getKanbanTaskPatch('project', none)).toEqual({ projectId: null });
  });

  it('pins the column project on a new task; "No project" pins nothing', () => {
    const [named, none] = columns();
    expect(getKanbanColumnCreateDefaults('project', named)).toEqual({ projectId: 'proj_a' });
    expect(getKanbanColumnCreateDefaults('project', none)).toEqual({});
    expect(
      getKanbanCreateTaskModalProps({ projectId: 'proj_a' }, { agentId: undefined }).projectId,
    ).toBe('proj_a');
  });

  it('keeps both pins when a project group is split by priority', () => {
    const [named, none] = columns();
    expect(
      getTaskSubGroupCreateDefaults(named.groupMeta, {
        groupBy: 'priority',
        key: 'priority:1',
        label: 'Urgent',
        priority: 1,
      }),
    ).toEqual({ priority: 1, projectId: 'proj_a' });
    expect(getTaskGroupCreateDefaults(none.groupMeta)).toEqual({});
  });
});
