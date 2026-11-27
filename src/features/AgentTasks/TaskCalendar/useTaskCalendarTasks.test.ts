import { describe, expect, it, vi } from 'vitest';

import {
  buildTaskCalendarParams,
  fetchTaskCalendar,
  TASK_CALENDAR_MAX_TASKS,
  TASK_CALENDAR_PAGE_SIZE,
} from './useTaskCalendarTasks';

const range = { from: new Date('2026-10-26T00:00:00Z'), to: new Date('2026-12-07T00:00:00Z') };
const filter = { assignee: { operator: 'is' as const, values: ['agt_1'] } };

describe('buildTaskCalendarParams', () => {
  it('asks the scheduled collection for its recurring tasks with the runs in the grid', () => {
    expect(
      buildTaskCalendarParams(
        { agentId: 'agt_1', collection: 'scheduled', filter, range },
        'private',
      ),
    ).toEqual({
      assigneeAgentId: 'agt_1',
      automated: true,
      filter,
      limit: TASK_CALENDAR_PAGE_SIZE,
      offset: 0,
      orderBy: 'updatedAt',
      projectId: undefined,
      runsBetween: range,
    });
  });

  it('asks the ordinary collection for its completed tasks, under the visibility chip', () => {
    expect(buildTaskCalendarParams({ collection: 'tasks', filter, range }, 'public')).toMatchObject(
      {
        automated: false,
        filter,
        statuses: ['completed'],
        visibility: 'public',
      },
    );
    // A project's page lists every task of the project, like its list view.
    expect(
      buildTaskCalendarParams({ collection: 'tasks', projectId: 'prj_1', range }, 'public'),
    ).toMatchObject({ projectId: 'prj_1', visibility: undefined });
  });

  it('keeps the "My tasks" scope', () => {
    expect(
      buildTaskCalendarParams({ collection: 'mine', myTaskScope: 'created', range }, undefined),
    ).toMatchObject({ scope: 'created', statuses: ['completed'] });
  });
});

describe('fetchTaskCalendar', () => {
  const rows = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `task-${start + index}`,
      seq: start + index,
      updatedAt: new Date(Date.UTC(2026, 10, 1) - (start + index) * 1000),
    }));
  const params = buildTaskCalendarParams({ collection: 'scheduled', range }, undefined);

  it('walks the keyset pages until a short page', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(0, TASK_CALENDAR_PAGE_SIZE), total: 520 })
      .mockResolvedValueOnce({ data: rows(TASK_CALENDAR_PAGE_SIZE, 20), total: 520 });

    const result = await fetchTaskCalendar(params, fetchPage);

    expect(result.tasks).toHaveLength(520);
    expect(result.truncated).toBe(false);
    const last = rows(0, TASK_CALENDAR_PAGE_SIZE).at(-1)!;
    expect(fetchPage.mock.calls[1][0]).toMatchObject({
      after: { at: last.updatedAt, seq: last.seq },
      offset: undefined,
    });
  });

  it('stops at the task ceiling and says the month is partial', async () => {
    let start = 0;
    const fetchPage = vi.fn(async () => {
      const data = rows(start, TASK_CALENDAR_PAGE_SIZE);
      start += TASK_CALENDAR_PAGE_SIZE;
      return { data, total: 5000 };
    });

    const result = await fetchTaskCalendar(params, fetchPage as never);

    expect(result.tasks).toHaveLength(TASK_CALENDAR_MAX_TASKS);
    expect(result.truncated).toBe(true);
  });

  it('passes on a run cap the server hit', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ data: rows(0, 3), rangeRunsTruncated: true, total: 3 });

    expect((await fetchTaskCalendar(params, fetchPage)).truncated).toBe(true);
  });
});
