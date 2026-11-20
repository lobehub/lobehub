import { describe, expect, it } from 'vitest';

import {
  getWidgetCardBody,
  getWidgetHealth,
  getWidgetUpdatedAt,
  WIDGET_STALE_GRACE_MS,
} from './widgetHealth';

const NOW = new Date('2026-09-29T12:00:00Z').getTime();
const stat = { type: 'stat' as const, value: 42 };

describe('getWidgetHealth', () => {
  it('reports a fresh, complete widget with no badges', () => {
    const health = getWidgetHealth(
      { lastRunStatus: 'succeeded', latestOutput: stat, publishedVersionId: 'v1' },
      { now: NOW },
    );
    expect(health.badges).toEqual([]);
    expect(health.hasOutput).toBe(true);
  });

  it('keeps the last successful output when the latest run failed', () => {
    const health = getWidgetHealth(
      {
        lastRunError: { code: 'NON_ZERO_EXIT', message: 'exit 1' },
        lastRunStatus: 'failed',
        latestOutput: stat,
        publishedVersionId: 'v1',
      },
      { now: NOW },
    );
    expect(health.failed).toBe(true);
    expect(health.hasOutput).toBe(true);
    expect(health.badges).toEqual(['failed']);
    expect(health.error?.message).toBe('exit 1');
  });

  it('treats a timeout as a failure', () => {
    expect(getWidgetHealth({ lastRunStatus: 'timeout' }, { now: NOW }).failed).toBe(true);
  });

  it('marks running from either the server snapshot or a local refresh', () => {
    expect(getWidgetHealth({ lastRunStatus: 'running' }, { now: NOW }).running).toBe(true);
    expect(
      getWidgetHealth({ lastRunStatus: 'succeeded' }, { now: NOW, runningLocally: true }).badges,
    ).toEqual(['running']);
  });

  it('marks a scheduled widget stale once its due run is overdue past the grace', () => {
    const base = { latestOutput: stat, publishedVersionId: 'v1', schedulePattern: '0 * * * *' };
    expect(
      getWidgetHealth(
        { ...base, nextRunAt: new Date(NOW - WIDGET_STALE_GRACE_MS - 1000) },
        { now: NOW },
      ).stale,
    ).toBe(true);
    expect(
      getWidgetHealth({ ...base, nextRunAt: new Date(NOW - 60_000) }, { now: NOW }).stale,
    ).toBe(false);
  });

  it('never calls a manual-only widget stale', () => {
    expect(
      getWidgetHealth({ latestOutput: stat, nextRunAt: new Date(0) }, { now: NOW }).stale,
    ).toBe(false);
  });

  it('flags a partial result with the script note', () => {
    const health = getWidgetHealth(
      {
        latestOutput: { ...stat, meta: { complete: false, message: 'GitLab API down' } },
        publishedVersionId: 'v1',
      },
      { now: NOW },
    );
    expect(health.partial).toBe(true);
    expect(health.partialMessage).toBe('GitLab API down');
  });

  it('orders badges by urgency', () => {
    const health = getWidgetHealth(
      {
        lastRunStatus: 'failed',
        latestOutput: { ...stat, meta: { complete: false } },
        nextRunAt: new Date(NOW - 2 * WIDGET_STALE_GRACE_MS),
        schedulePattern: '*/5 * * * *',
      },
      { now: NOW },
    );
    expect(health.badges).toEqual(['failed', 'stale', 'partial']);
  });

  it('knows an unpublished widget', () => {
    expect(getWidgetHealth({}, { now: NOW }).unpublished).toBe(true);
  });
});

describe('getWidgetUpdatedAt', () => {
  it('prefers the time of the shown output over the last attempt', () => {
    expect(
      getWidgetUpdatedAt({
        lastRunAt: '2026-09-29T11:00:00Z',
        latestOutputAt: '2026-09-29T10:00:00Z',
      }),
    ).toBe('2026-09-29T10:00:00Z');
    expect(getWidgetUpdatedAt({ lastRunAt: '2026-09-29T11:00:00Z' })).toBe('2026-09-29T11:00:00Z');
  });
});

describe('getWidgetCardBody', () => {
  const body = (widget: Parameters<typeof getWidgetHealth>[0], runningLocally = false) =>
    getWidgetCardBody(getWidgetHealth(widget, { now: NOW, runningLocally }));

  it('keeps showing the last good output after a failed run', () => {
    expect(body({ lastRunStatus: 'failed', latestOutput: stat, publishedVersionId: 'v1' })).toBe(
      'output',
    );
  });

  it('keeps showing the last good output while a refresh runs', () => {
    expect(body({ latestOutput: stat, publishedVersionId: 'v1' }, true)).toBe('output');
  });

  it('explains a failure with no good result instead of rendering a value', () => {
    expect(body({ lastRunStatus: 'failed', publishedVersionId: 'v1' })).toBe('failedNoOutput');
    expect(body({ lastRunStatus: 'timeout', publishedVersionId: 'v1' })).toBe('failedNoOutput');
  });

  it('distinguishes a first run, a never-run widget and an unpublished one', () => {
    expect(body({ lastRunStatus: 'running', publishedVersionId: 'v1' })).toBe('firstRun');
    expect(body({ publishedVersionId: 'v1' })).toBe('noRun');
    expect(body({})).toBe('unpublished');
  });
});
