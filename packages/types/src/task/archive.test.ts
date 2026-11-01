import { describe, expect, it } from 'vitest';

import { isTaskArchiveBlocked } from './archive';

describe('isTaskArchiveBlocked', () => {
  it('blocks a task that is mid-run', () => {
    expect(isTaskArchiveBlocked({ status: 'running' })).toBe(true);
  });

  it('blocks a schedule or heartbeat that can still fire', () => {
    expect(
      isTaskArchiveBlocked({
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        status: 'scheduled',
      }),
    ).toBe(true);
    expect(
      isTaskArchiveBlocked({
        automationMode: 'heartbeat',
        heartbeatInterval: 600,
        status: 'backlog',
      }),
    ).toBe(true);
  });

  it('allows automation that can no longer fire', () => {
    expect(
      isTaskArchiveBlocked({
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        status: 'completed',
      }),
    ).toBe(false);
    expect(
      isTaskArchiveBlocked({ automationMode: 'schedule', schedulePattern: '', status: 'backlog' }),
    ).toBe(false);
    expect(
      isTaskArchiveBlocked({ automationMode: 'heartbeat', heartbeatInterval: 0, status: 'paused' }),
    ).toBe(false);
  });

  it('allows a paused schedule, which cannot fire, but not a paused heartbeat', () => {
    expect(
      isTaskArchiveBlocked({
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        status: 'paused',
      }),
    ).toBe(false);
    expect(
      isTaskArchiveBlocked({
        automationMode: 'heartbeat',
        heartbeatInterval: 600,
        status: 'paused',
      }),
    ).toBe(true);
  });

  it('allows ordinary idle or finished tasks', () => {
    for (const status of ['backlog', 'paused', 'completed', 'canceled', 'failed']) {
      expect(isTaskArchiveBlocked({ status })).toBe(false);
    }
  });
});
