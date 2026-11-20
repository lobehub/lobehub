import { describe, expect, it } from 'vitest';

import type { ProjectOverview } from '@/store/project';

import { isRichFolder, resolveFolderSheet, resolveOverviewStatus } from './folderSheet';

const task = (name: string, day: number) => ({
  id: `task_${name}`,
  identifier: `T-${day}`,
  name,
  status: 'backlog',
  summary: null,
  updatedAt: new Date(2026, 0, day),
});

const overview = (patch: Partial<ProjectOverview> = {}): ProjectOverview => ({
  agentCount: 1,
  agents: [],
  projectId: 'prj_1',
  recentTasks: [],
  taskCount: 0,
  taskDoneCount: 0,
  ...patch,
});

describe('resolveFolderSheet', () => {
  it('waits for the overview batch before claiming there are no tasks', () => {
    expect(resolveFolderSheet(undefined, 'loading')).toEqual({ kind: 'pending' });
  });

  it('shows the brief when the loaded batch has no row for the project', () => {
    expect(resolveFolderSheet(undefined, 'loaded')).toEqual({ kind: 'intro' });
  });

  it('shows the brief when the project has no tasks', () => {
    expect(resolveFolderSheet(overview(), 'loaded')).toEqual({ kind: 'intro' });
  });

  it('heads the paper with the latest task and lists up to three others', () => {
    const tasks = [task('e', 5), task('d', 4), task('c', 3), task('b', 2), task('a', 1)];
    const sheet = resolveFolderSheet(overview({ recentTasks: tasks, taskCount: 5 }), 'loaded');

    expect(sheet).toEqual({ kind: 'tasks', latest: tasks[0], others: tasks.slice(1, 4) });
  });

  it('lists no rows when the project has a single task', () => {
    const only = task('only', 1);

    expect(resolveFolderSheet(overview({ recentTasks: [only], taskCount: 1 }), 'loaded')).toEqual({
      kind: 'tasks',
      latest: only,
      others: [],
    });
  });
});

describe('resolveOverviewStatus', () => {
  it('is loading until the batch arrives', () => {
    expect(resolveOverviewStatus({ error: undefined, loaded: false })).toBe('loading');
  });

  it('fails when the first fetch errors, instead of staying pending', () => {
    expect(resolveOverviewStatus({ error: new Error('boom'), loaded: false })).toBe('failed');
  });

  it('keeps a cached batch when a later revalidation fails', () => {
    expect(resolveOverviewStatus({ error: new Error('boom'), loaded: true })).toBe('loaded');
  });
});

describe('resolveFolderSheet after a failed overview', () => {
  it('shows the brief without the loading placeholders', () => {
    expect(resolveFolderSheet(undefined, 'failed')).toEqual({ kind: 'unavailable' });
  });

  it('still shows a project row that is already loaded', () => {
    const only = task('only', 1);

    expect(resolveFolderSheet(overview({ recentTasks: [only], taskCount: 1 }), 'failed')).toEqual({
      kind: 'tasks',
      latest: only,
      others: [],
    });
  });
});

describe('isRichFolder', () => {
  it('is plain without an overview', () => {
    expect(isRichFolder(undefined)).toBe(false);
  });

  it('is plain while the front paper lists every task', () => {
    expect(isRichFolder(overview({ taskCount: 4 }))).toBe(false);
  });

  it('is rich past what the front paper lists', () => {
    expect(isRichFolder(overview({ taskCount: 5 }))).toBe(true);
  });
});
