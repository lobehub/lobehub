import { describe, expect, it } from 'vitest';

import { getWidgetHealth } from '../utils/widgetHealth';
import { getHealthTone } from './HealthDot';

const output = { type: 'stat', value: 1 } as const;
const NOW = new Date('2026-10-04T00:00:00Z').getTime();

describe('getHealthTone', () => {
  it('reads a running widget as running even when its last run failed', () => {
    const health = getWidgetHealth(
      { lastRunStatus: 'failed', latestOutput: output },
      { now: NOW, runningLocally: true },
    );
    expect(getHealthTone(health)).toBe('running');
  });

  it('puts a failed run ahead of stale data', () => {
    const health = getWidgetHealth(
      {
        lastRunStatus: 'failed',
        latestOutput: output,
        nextRunAt: new Date(NOW - 2 * 60 * 60 * 1000),
        schedulePattern: '0 * * * *',
      },
      { now: NOW },
    );
    expect(getHealthTone(health)).toBe('failed');
  });

  it('reads an overdue schedule or a partial result as stale', () => {
    const overdue = getWidgetHealth(
      {
        lastRunStatus: 'succeeded',
        latestOutput: output,
        nextRunAt: new Date(NOW - 2 * 60 * 60 * 1000),
        schedulePattern: '0 * * * *',
      },
      { now: NOW },
    );
    const partial = getWidgetHealth(
      { lastRunStatus: 'succeeded', latestOutput: { ...output, meta: { complete: false } } },
      { now: NOW },
    );
    expect(getHealthTone(overdue)).toBe('stale');
    expect(getHealthTone(partial)).toBe('stale');
  });

  it('is ok with fresh output and idle before any output exists', () => {
    expect(
      getHealthTone(
        getWidgetHealth({ lastRunStatus: 'succeeded', latestOutput: output }, { now: NOW }),
      ),
    ).toBe('ok');
    expect(getHealthTone(getWidgetHealth({}, { now: NOW }))).toBe('idle');
  });
});
