import { describe, expect, it } from 'vitest';

import { buildTaskCalendarParams, TASK_CALENDAR_PAGE_SIZE } from './useTaskCalendarTasks';

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
