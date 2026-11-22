import { describe, expect, it } from 'vitest';

import {
  groupScheduleRows,
  resolveRunOutcome,
  resolveScheduleState,
  type ScheduleTaskInput,
} from './scheduleState';

// Sunday 2026-11-22 12:00 UTC.
const NOW = new Date('2026-11-22T12:00:00Z');

const daily = (overrides: Partial<ScheduleTaskInput> = {}): ScheduleTaskInput => ({
  automationMode: 'schedule',
  id: 'task_daily',
  schedulePattern: '0 14 * * *',
  scheduleTimezone: 'UTC',
  status: 'scheduled',
  ...overrides,
});

const heartbeat = (overrides: Partial<ScheduleTaskInput> = {}): ScheduleTaskInput => ({
  automationMode: 'heartbeat',
  heartbeatInterval: 3600,
  id: 'task_heartbeat',
  status: 'scheduled',
  ...overrides,
});

const failures = (consecutiveFailures: number) => ({ scheduler: { consecutiveFailures } });

describe('resolveScheduleState', () => {
  describe('a schedule waiting for its next run', () => {
    it("fires at the pattern's next occurrence in its own timezone", () => {
      expect(resolveScheduleState(daily(), NOW)).toMatchObject({
        group: 'scheduled',
        health: 'scheduled',
        nextRunAt: new Date('2026-11-22T14:00:00Z'),
      });
      // 14:00 in Shanghai is 06:00 UTC, already past today.
      expect(
        resolveScheduleState(daily({ scheduleTimezone: 'Asia/Shanghai' }), NOW).nextRunAt,
      ).toEqual(new Date('2026-11-23T06:00:00Z'));
    });

    it('treats a backlog task with a schedule as armed: the dispatcher still fires it', () => {
      expect(resolveScheduleState(daily({ status: 'backlog' }), NOW).health).toBe('scheduled');
    });

    it('keeps a retrying schedule armed and reports its failures', () => {
      expect(resolveScheduleState(daily({ context: failures(2) }), NOW)).toMatchObject({
        consecutiveFailures: 2,
        health: 'scheduled',
        nextRunAt: new Date('2026-11-22T14:00:00Z'),
      });
    });

    it('gives no next run for a pattern that cannot be evaluated', () => {
      expect(resolveScheduleState(daily({ schedulePattern: 'nonsense' }), NOW)).toMatchObject({
        health: 'scheduled',
        nextRunAt: null,
      });
    });
  });

  describe('a heartbeat waiting for its next tick', () => {
    it('fires one interval after the pending tick was enqueued', () => {
      const task = heartbeat({
        context: { scheduler: { scheduledAt: '2026-11-22T11:40:00Z' } },
        lastHeartbeatAt: '2026-11-22T09:00:00Z',
      });
      expect(resolveScheduleState(task, NOW).nextRunAt).toEqual(new Date('2026-11-22T12:40:00Z'));
    });

    it('steps past now when the last tick is stale', () => {
      const task = heartbeat({ lastHeartbeatAt: '2026-11-22T08:30:00Z' });
      expect(resolveScheduleState(task, NOW).nextRunAt).toEqual(new Date('2026-11-22T12:30:00Z'));
    });

    it('counts from now when it has never ticked', () => {
      expect(resolveScheduleState(heartbeat(), NOW).nextRunAt).toEqual(
        new Date('2026-11-22T13:00:00Z'),
      );
    });
  });

  describe('a task that will not fire on its own', () => {
    it('is stopped once the failure fuse blows, whatever its status says', () => {
      // A heartbeat keeps `scheduled` after its fuse blows; it is just never re-armed.
      expect(resolveScheduleState(heartbeat({ context: failures(3) }), NOW)).toMatchObject({
        group: 'attention',
        health: 'stopped',
        nextRunAt: null,
      });
      expect(
        resolveScheduleState(daily({ context: failures(3), status: 'paused' }), NOW).health,
      ).toBe('stopped');
    });

    it('is awaiting review while paused', () => {
      expect(resolveScheduleState(daily({ status: 'paused' }), NOW)).toMatchObject({
        group: 'attention',
        health: 'awaitingReview',
        nextRunAt: null,
      });
    });

    it('is awaiting the user while an urgent brief is unanswered', () => {
      expect(resolveScheduleState(daily({ awaitingHuman: true }), NOW)).toMatchObject({
        group: 'attention',
        health: 'awaitingHuman',
        nextRunAt: null,
      });
      // Answering the brief is the way out of the pause too.
      expect(
        resolveScheduleState(daily({ awaitingHuman: true, status: 'paused' }), NOW).health,
      ).toBe('awaitingHuman');
    });
  });

  describe('a running task', () => {
    it('is running from the start of its run in flight', () => {
      const task = daily({
        recentRuns: [
          {
            completedAt: null,
            createdAt: new Date('2026-11-22T11:50:00Z'),
            seq: 2,
            status: 'running',
            topicId: 'tpc_2',
            trigger: 'manual',
          },
        ],
        startedAt: '2026-11-01T00:00:00Z',
        status: 'running',
      });
      expect(resolveScheduleState(task, NOW)).toMatchObject({
        group: 'running',
        health: 'running',
        nextRunAt: null,
        runningSince: new Date('2026-11-22T11:50:00Z'),
      });
    });

    it('is an overrun once an occurrence was lost to it', () => {
      // Started before yesterday's 14:00 and still going: that slot never fired.
      const task = daily({ startedAt: '2026-11-21T13:00:00Z', status: 'running' });
      expect(resolveScheduleState(task, NOW)).toMatchObject({
        group: 'attention',
        health: 'overrun',
        runningSince: new Date('2026-11-21T13:00:00Z'),
      });
    });

    it('is still just running inside the grace window of the occurrence it overlaps', () => {
      const task = daily({
        schedulePattern: '50 11 * * *',
        startedAt: '2026-11-22T11:00:00Z',
        status: 'running',
      });
      expect(resolveScheduleState(task, NOW).health).toBe('running');
    });

    it('calls a heartbeat run an overrun after two intervals, and never before two hours', () => {
      const run = (startedAt: string, heartbeatInterval: number) =>
        resolveScheduleState(heartbeat({ heartbeatInterval, startedAt, status: 'running' }), NOW)
          .health;
      // A 10-minute heartbeat with a 90-minute run is long, not stuck.
      expect(run('2026-11-22T10:30:00Z', 600)).toBe('running');
      expect(run('2026-11-22T09:30:00Z', 600)).toBe('overrun');
      // A 4-hour heartbeat gets two full intervals.
      expect(run('2026-11-22T05:00:00Z', 4 * 3600)).toBe('running');
      expect(run('2026-11-22T03:00:00Z', 4 * 3600)).toBe('overrun');
    });

    it('is running, not an overrun, when the start of the run is unknown', () => {
      expect(resolveScheduleState(daily({ status: 'running' }), NOW)).toMatchObject({
        health: 'running',
        runningSince: null,
      });
    });
  });
});

describe('groupScheduleRows', () => {
  it('lists what needs the user, then running, then waiting by next run', () => {
    const groups = groupScheduleRows(
      [
        daily({ id: 'evening', schedulePattern: '0 20 * * *' }),
        daily({ id: 'overrun', startedAt: '2026-11-20T00:00:00Z', status: 'running' }),
        daily({ id: 'afternoon' }),
        daily({ id: 'review', status: 'paused' }),
        heartbeat({ id: 'running', startedAt: '2026-11-22T11:55:00Z', status: 'running' }),
        heartbeat({ context: failures(3), id: 'stopped' }),
        daily({ awaitingHuman: true, id: 'question' }),
        daily({ id: 'broken', schedulePattern: 'nonsense' }),
        daily({ id: 'broken-too', schedulePattern: 'nonsense' }),
      ],
      NOW,
    );

    expect(groups.map((group) => [group.key, group.rows.map((row) => row.task.id)])).toEqual([
      ['attention', ['stopped', 'question', 'review', 'overrun']],
      ['running', ['running']],
      ['scheduled', ['afternoon', 'evening', 'broken', 'broken-too']],
    ]);
  });

  it('leaves empty sections out', () => {
    expect(groupScheduleRows([daily()], NOW).map((group) => group.key)).toEqual(['scheduled']);
    expect(groupScheduleRows([], NOW)).toEqual([]);
  });
});

describe('resolveRunOutcome', () => {
  it('reads a run status as its outcome', () => {
    expect(resolveRunOutcome('completed')).toBe('succeeded');
    expect(resolveRunOutcome('failed')).toBe('failed');
    expect(resolveRunOutcome('timeout')).toBe('failed');
    expect(resolveRunOutcome('canceled')).toBe('canceled');
    expect(resolveRunOutcome('running')).toBe('running');
    expect(resolveRunOutcome('quota_limited')).toBe('interrupted');
    expect(resolveRunOutcome('device_offline')).toBe('interrupted');
  });

  it('does not claim success or failure for a status it does not know', () => {
    expect(resolveRunOutcome('something_new')).toBe('interrupted');
  });
});
