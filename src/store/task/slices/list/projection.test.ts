import { describe, expect, it } from 'vitest';

import type { TaskGroupListValue, TaskListValue } from './projection';
import { taskGroupListEntity, taskListEntity } from './projection';

const row = (id: string, projectId: string | null | undefined) =>
  ({ id, identifier: id, projectId, status: 'backlog' }) as TaskListValue['items'][number];

const list = (projectId?: string): TaskListValue => ({
  items: [row('a', 'p1'), row('b', 'p1')],
  ...(projectId && { projectId }),
  total: 2,
});

const board = (projectId?: string): TaskGroupListValue => ({
  groupBy: 'status',
  groups: [{ key: 'backlog', tasks: [row('a', 'p1'), row('b', 'p1')], total: 2 }],
  ...(projectId && { projectId }),
});

describe('project scope of a task collection', () => {
  it.each([['p2'], [null]])('drops a row moved to %j from the old project list', (projectId) => {
    const next = taskListEntity.map(list('p1'), 'a', (task) => ({ ...task, projectId }));
    expect(next?.items.map((task) => task.id)).toEqual(['b']);
    expect(next?.total).toBe(1);
  });

  it('keeps a row that stays in the project', () => {
    const next = taskListEntity.map(list('p1'), 'a', (task) => ({ ...task, name: 'renamed' }));
    expect(next?.items.map((task) => task.id)).toEqual(['a', 'b']);
    expect(next?.total).toBe(2);
  });

  it('keeps a moved row in a list that is not scoped to a project', () => {
    const next = taskListEntity.map(list(), 'a', (task) => ({ ...task, projectId: 'p2' }));
    expect(next?.items[0].projectId).toBe('p2');
    expect(next?.total).toBe(2);
  });

  it('keeps a persisted row that predates the field', () => {
    const value = { ...list('p1'), items: [row('a', undefined)] };
    const next = taskListEntity.map(value, 'a', (task) => ({ ...task, name: 'renamed' }));
    expect(next?.items).toHaveLength(1);
  });

  it.each([['p2'], [null]])('takes a card moved to %j off the old project board', (projectId) => {
    const next = taskGroupListEntity.map(board('p1'), 'a', (task) => ({ ...task, projectId }));
    expect(next?.groups[0].tasks.map((task) => task.id)).toEqual(['b']);
    expect(next?.groups[0].total).toBe(1);
  });

  it('keeps a moved card on a board that is not scoped to a project', () => {
    const next = taskGroupListEntity.map(board(), 'a', (task) => ({ ...task, projectId: 'p2' }));
    expect(next?.groups[0].tasks[0].projectId).toBe('p2');
    expect(next?.groups[0].total).toBe(2);
  });
});

describe('a project board', () => {
  const projectBoard = (): TaskGroupListValue =>
    ({
      groupBy: 'project',
      groups: [
        { key: 'project:p1', projectId: 'p1', tasks: [row('a', 'p1'), row('b', 'p1')], total: 2 },
        { key: 'project:none', projectId: null, tasks: [], total: 0 },
      ],
    }) as unknown as TaskGroupListValue;

  it('moves a card to "No project" when its project is cleared', () => {
    const next = taskGroupListEntity.map(projectBoard(), 'a', (task) => ({
      ...task,
      projectId: null,
    }));

    expect(next.groups[0]).toMatchObject({ total: 1 });
    expect(next.groups[0].tasks.map((task) => task.id)).toEqual(['b']);
    expect(next.groups[1]).toMatchObject({ total: 1 });
    expect(next.groups[1].tasks.map((task) => task.id)).toEqual(['a']);
  });

  it('opens a column for the first task of a project', () => {
    const next = taskGroupListEntity.map(projectBoard(), 'a', (task) => ({
      ...task,
      projectId: 'p2',
    }));

    expect(next.groups[2]).toMatchObject({ key: 'project:p2', projectId: 'p2', total: 1 });
    expect(next.groups[2].tasks[0].projectId).toBe('p2');
    expect(next.groups[0].total).toBe(1);
  });

  it('leaves the columns alone when something else changes', () => {
    const next = taskGroupListEntity.map(projectBoard(), 'a', (task) => ({
      ...task,
      status: 'running',
    }));

    expect(next.groups[0].tasks.map((task) => task.id)).toEqual(['a', 'b']);
    expect(next.groups[0].tasks[0].status).toBe('running');
    expect(next.groups[0].total).toBe(2);
  });
});
