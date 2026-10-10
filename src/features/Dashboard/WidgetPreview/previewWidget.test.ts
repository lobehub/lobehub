import { describe, expect, it } from 'vitest';

import {
  canCreateDashboardFromPreview,
  canPreviewPublish,
  defaultDiffPair,
  findSucceededPreviewRun,
  getPreviewPublishState,
  placeableDashboards,
  placementBoards,
  resolvePublishSchedule,
  toPreviewWidget,
} from './previewWidget';

const widget = {
  draftVersionId: 'v2',
  id: 'w1',
  latestOutput: { type: 'stat', value: 1 },
  latestOutputAt: '2026-01-01T00:00:00Z',
  nextRunAt: '2026-01-01T01:00:00Z',
  publishedVersionId: 'v1',
  schedulePattern: '0 * * * *',
} as any;

describe('toPreviewWidget', () => {
  it('shows the dry run instead of the live snapshot', () => {
    const preview = toPreviewWidget(widget, {
      error: null,
      finishedAt: '2026-02-02T00:00:00Z',
      output: { type: 'stat', value: 42 },
      startedAt: '2026-02-02T00:00:00Z',
      status: 'succeeded',
      versionId: 'v2',
    } as any);

    expect(preview.latestOutput).toEqual({ type: 'stat', value: 42 });
    expect(preview.lastRunStatus).toBe('succeeded');
    // A preview is not late for a schedule.
    expect(preview.schedulePattern).toBeNull();
  });

  it('never shows the live value as the result of a failed dry run', () => {
    const preview = toPreviewWidget(widget, {
      error: { code: 'NON_ZERO_EXIT', message: 'boom' },
      finishedAt: null,
      output: null,
      startedAt: '2026-02-02T00:00:00Z',
      status: 'failed',
      versionId: 'v2',
    } as any);

    expect(preview.latestOutput).toBeNull();
    expect(preview.lastRunError).toEqual({ code: 'NON_ZERO_EXIT', message: 'boom' });
  });

  it('shows a partial dry run, whose output is usable', () => {
    const output = { meta: { complete: false }, type: 'stat', value: 3 };
    const preview = toPreviewWidget(widget, {
      error: null,
      finishedAt: '2026-02-02T00:00:00Z',
      output,
      startedAt: '2026-02-02T00:00:00Z',
      status: 'partial',
      versionId: 'v2',
    } as any);

    expect(preview.latestOutput).toEqual(output);
  });
});

describe('getPreviewPublishState', () => {
  it('offers publishing only for a successful run of the current draft', () => {
    expect(getPreviewPublishState(widget, { status: 'succeeded', versionId: 'v2' })).toBe(
      'publishable',
    );
    expect(getPreviewPublishState(widget, { status: 'failed', versionId: 'v2' })).toBe('notReady');
    // An incomplete result is still usable output, and the server publishes it.
    expect(getPreviewPublishState(widget, { status: 'partial', versionId: 'v2' })).toBe(
      'publishable',
    );
    expect(getPreviewPublishState(widget, { status: 'succeeded', versionId: 'v0' })).toBe(
      'outdated',
    );
    expect(getPreviewPublishState(widget, { status: 'succeeded', versionId: 'v1' })).toBe('live');
  });

  it('marks a preview of an archived version outdated once nothing points at it', () => {
    // v1 and v2 went live and the draft is gone: reopening v1's successful
    // preview must not offer publishing it — the server would accept the
    // archived version and silently roll the widget back.
    const rolled = { draftVersionId: null, publishedVersionId: 'v2' };
    expect(getPreviewPublishState(rolled, { status: 'succeeded', versionId: 'v1' })).toBe(
      'outdated',
    );
    expect(getPreviewPublishState(rolled, { status: 'succeeded', versionId: 'v2' })).toBe('live');
    expect(
      getPreviewPublishState(
        { draftVersionId: null, publishedVersionId: null },
        { status: 'succeeded', versionId: 'v1' },
      ),
    ).toBe('outdated');
  });
});

describe('canPreviewPublish', () => {
  const widget = { userId: 'u-creator' };

  it('offers publishing to the widget creator', () => {
    expect(canPreviewPublish(widget, 'u-creator')).toBe(true);
  });

  it('hides publishing from everyone else, so teammates never hit a guaranteed failure', () => {
    expect(canPreviewPublish(widget, 'u-member')).toBe(false);
    expect(canPreviewPublish(widget, null)).toBe(false);
    expect(canPreviewPublish(widget, undefined)).toBe(false);
  });
});

describe('canCreateDashboardFromPreview', () => {
  it('always offers creation in personal mode', () => {
    expect(canCreateDashboardFromPreview(null, false)).toBe(true);
    expect(canCreateDashboardFromPreview(undefined, false)).toBe(true);
    expect(canCreateDashboardFromPreview('p1', false)).toBe(true);
  });

  it('hides creation for a project-less widget inside a workspace', () => {
    // The board would land on the workspace home level, whose /dashboard
    // routes are disabled there — nothing could open it.
    expect(canCreateDashboardFromPreview(null, true)).toBe(false);
    expect(canCreateDashboardFromPreview(undefined, true)).toBe(false);
    // A project widget still creates inside its project, where routes exist.
    expect(canCreateDashboardFromPreview('p1', true)).toBe(true);
  });
});

describe('placementBoards', () => {
  const home = [
    { agentId: null, id: 'h1', projectId: null },
    { agentId: null, id: 'h2', projectId: null },
  ];
  const project = [
    { agentId: null, id: 'p1', projectId: 'prj' },
    { agentId: null, id: 'p2', projectId: 'prj' },
  ];

  it('lists the widget’s project boards ahead of the home boards', () => {
    expect(placementBoards(home, project, 'prj')).toEqual([
      project[0],
      project[1],
      home[0],
      home[1],
    ]);
    expect(placementBoards(home, project, null)).toEqual(home);
    expect(placementBoards(home, project, undefined)).toEqual(home);
  });

  it('offers no workspace-root boards while a workspace is active', () => {
    const agentLevel = { agentId: 'ag1', id: 'a1', projectId: null };
    // Workspace-root boards have no UI inside a workspace — the home level
    // contributes only boards that live under a project or an agent.
    expect(placementBoards([...home, agentLevel], [], undefined, true)).toEqual([agentLevel]);
    expect(placementBoards(home, [], null, true)).toEqual([]);
    // Personal mode keeps the home route, and project widgets keep their
    // project boards in both modes.
    expect(placementBoards(home, [], undefined, false)).toEqual(home);
    expect(placementBoards(home, project, 'prj', true)).toEqual(project);
  });
});

describe('placeableDashboards', () => {
  const boards = [
    { id: 'd1', title: 'Mine', userId: 'u-member' },
    { id: 'd2', title: 'Teammate public', userId: 'u-owner' },
  ];

  it('offers only the caller’s own boards — placement writes as the board’s creator', () => {
    expect(placeableDashboards(boards, 'u-member')).toEqual([boards[0]]);
    expect(placeableDashboards(boards, 'u-owner')).toEqual([boards[1]]);
  });

  it('offers nothing while the current user is unknown', () => {
    expect(placeableDashboards(boards, undefined)).toEqual([]);
    expect(placeableDashboards(boards, null)).toEqual([]);
  });
});

describe('resolvePublishSchedule', () => {
  const manifest = { schedule: { pattern: '0 6 * * *', timezone: 'Asia/Shanghai' } };

  it('keeps the widget’s own schedule when the version suggests another', () => {
    // What makeLive persists: the persisted cadence wins, never the suggestion.
    expect(
      resolvePublishSchedule({ schedulePattern: '0 * * * *', scheduleTimezone: 'UTC' }, manifest),
    ).toEqual({ pattern: '0 * * * *', timezone: 'UTC' });
  });

  it('adopts a valid manifest suggestion only when the widget has no schedule', () => {
    expect(
      resolvePublishSchedule({ schedulePattern: null, scheduleTimezone: null }, manifest),
    ).toEqual({ pattern: '0 6 * * *', timezone: 'Asia/Shanghai' });
    expect(
      resolvePublishSchedule({ schedulePattern: '', scheduleTimezone: null }, manifest),
    ).toEqual({ pattern: '0 6 * * *', timezone: 'Asia/Shanghai' });
  });

  it('resolves to no schedule without a persisted one and without a valid suggestion', () => {
    expect(
      resolvePublishSchedule(
        { schedulePattern: null, scheduleTimezone: null },
        { schedule: { pattern: 'not a cron' } },
      ),
    ).toEqual({});
    expect(resolvePublishSchedule({ schedulePattern: null, scheduleTimezone: null }, null)).toEqual(
      {},
    );
    expect(resolvePublishSchedule({ schedulePattern: null, scheduleTimezone: null }, {})).toEqual(
      {},
    );
  });
});

describe('findSucceededPreviewRun', () => {
  it('picks the newest successful dry run of that version', () => {
    const runs = [
      { id: 'r4', status: 'succeeded', trigger: 'manual', versionId: 'v2' },
      { id: 'r3', status: 'failed', trigger: 'preview', versionId: 'v2' },
      { id: 'r2', status: 'succeeded', trigger: 'preview', versionId: 'v2' },
      { id: 'r1', status: 'succeeded', trigger: 'preview', versionId: 'v2' },
    ] as any[];
    expect(findSucceededPreviewRun(runs, 'v2')?.id).toBe('r2');
    expect(findSucceededPreviewRun(runs, 'v9')).toBeUndefined();
    expect(findSucceededPreviewRun(runs, undefined)).toBeUndefined();
  });
});

describe('defaultDiffPair', () => {
  const versions = [
    { id: 'v3', parentVersionId: 'v2', status: 'draft' as const },
    { id: 'v2', parentVersionId: 'v1', status: 'published' as const },
    { id: 'v1', parentVersionId: null, status: 'archived' as const },
  ];

  it('compares the reviewed version against the live one', () => {
    expect(defaultDiffPair(versions, 'v3')).toEqual({ baseId: 'v2', targetId: 'v3' });
  });

  it('falls back to the parent (or the previous version) for the live version itself', () => {
    expect(defaultDiffPair(versions, 'v2')).toEqual({ baseId: 'v1', targetId: 'v2' });
    expect(defaultDiffPair(versions)).toEqual({ baseId: 'v2', targetId: 'v3' });
    expect(defaultDiffPair([])).toEqual({});
  });
});
