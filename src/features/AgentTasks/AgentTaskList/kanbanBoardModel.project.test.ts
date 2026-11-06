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

    expect(columns.map((column) => column.key)).toEqual(['project:none']);
    expect(JSON.stringify(columns)).not.toContain('gone');
  });
});

describe('mergeUnresolvedProjectGroups', () => {
  it('folds unseen projects into "No project", tasks and totals included', () => {
    const [none, ...rest] = mergeUnresolvedProjectGroups(
      [
        group('project:none', null, ['t0']),
        group('project:proj_a', 'proj_a', ['t1']),
        group('project:gone', 'gone', ['t2', 't3']),
      ],
      projects,
    );

    expect(none.tasks.map((task) => task.id)).toEqual(['t0', 't2', 't3']);
    expect(none.total).toBe(3);
    expect(rest.map((item) => item.key)).toEqual(['project:proj_a']);
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
