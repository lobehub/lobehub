// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { armScheduleOnColumnWrite } from './armScheduleOnColumnWrite';

describe('armScheduleOnColumnWrite / T-634 arming window', () => {
  const task = (overrides: Record<string, unknown> = {}) => ({
    automationMode: 'schedule' as string | null,
    context: {} as unknown,
    id: 'task-1',
    schedulePattern: '0 10 27 9 *' as string | null,
    status: 'backlog',
    ...overrides,
  });

  it('stamps the window on a backlog task armed without a status transition', () => {
    const result = armScheduleOnColumnWrite(task());

    expect(result.context).toBeDefined();
    const stamped = (result.context as any).scheduler.scheduleStartedAt as string;
    expect(Number.isNaN(Date.parse(stamped))).toBe(false);
  });

  it('keeps the other context pockets', () => {
    const origin = { topicId: 'tpc_1' };

    const result = armScheduleOnColumnWrite(
      task({ context: { origin, scheduler: { consecutiveFailures: 0 } } }),
    );

    expect(result.context).toEqual({
      origin,
      scheduler: { consecutiveFailures: 0, scheduleStartedAt: expect.any(String) },
    });
  });

  it('does not reset an existing quota window on re-arm', () => {
    expect(
      armScheduleOnColumnWrite(
        task({ context: { scheduler: { scheduleStartedAt: '2026-09-20T06:00:00.000Z' } } }),
      ),
    ).toEqual({});
  });

  it('does not arm without a cron pattern or in non-schedule mode', () => {
    expect(armScheduleOnColumnWrite(task({ schedulePattern: null }))).toEqual({});
    expect(armScheduleOnColumnWrite(task({ schedulePattern: '' }))).toEqual({});
    expect(armScheduleOnColumnWrite(task({ automationMode: 'heartbeat' }))).toEqual({});
    expect(armScheduleOnColumnWrite(task({ automationMode: null }))).toEqual({});
  });

  it('stamps a heartbeat→cron switched task still in scheduled status (P1)', () => {
    // A heartbeat task switched to cron via the column-only path keeps status
    // `scheduled`; getScheduledTasks dispatches scheduled rows, so the row
    // must be stamped here, not skipped — otherwise a grace-window occurrence
    // replays and burns a one-shot maxExecutions quota.
    const result = armScheduleOnColumnWrite(task({ status: 'scheduled' }));

    expect(result.context).toBeDefined();
    const stamped = (result.context as any).scheduler.scheduleStartedAt as string;
    expect(Number.isNaN(Date.parse(stamped))).toBe(false);
  });

  it('skips statuses the dispatcher does not fire or that carry their own stamping', () => {
    for (const status of ['running', 'paused', 'completed', 'failed', 'canceled']) {
      expect(armScheduleOnColumnWrite(task({ status })), `status=${status}`).toEqual({});
    }
  });
});
