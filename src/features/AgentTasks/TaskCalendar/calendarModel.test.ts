import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import {
  buildMonthGrid,
  collectCompletedEntries,
  collectScheduledEntries,
  dayKey,
  expandPlannedRuns,
  groupEntriesByDay,
  MAX_PLANNED_PER_TASK,
  resolveWeekStart,
  toCalendarRunOutcome,
} from './calendarModel';

const task = (fields: Partial<TaskListItem>): TaskListItem =>
  ({
    id: 'task-1',
    identifier: 'T-1',
    participants: [],
    status: 'scheduled',
    ...fields,
  }) as TaskListItem;

const run = (fields: Partial<NonNullable<TaskListItem['rangeRuns']>[number]>) => ({
  agentId: 'agt_1',
  completedAt: null,
  createdAt: new Date('2026-11-02T09:00:00Z'),
  note: null,
  seq: 1,
  status: 'completed',
  topicId: 'tpc_1',
  trigger: 'schedule' as const,
  ...fields,
});

const NOVEMBER_UTC = {
  from: new Date('2026-11-01T00:00:00Z'),
  to: new Date('2026-12-01T00:00:00Z'),
};

describe('buildMonthGrid', () => {
  it('lays out whole weeks from the week of the 1st to the week of the last day', () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const mondayFirst = buildMonthGrid(dayjs('2026-11-15'), 1);
    expect(mondayFirst.weeks).toHaveLength(6);
    expect(dayKey(mondayFirst.weeks[0][0])).toBe('2026-10-26');
    expect(dayKey(mondayFirst.weeks.at(-1)!.at(-1)!)).toBe('2026-12-06');
    expect(dayKey(mondayFirst.from)).toBe('2026-10-26');
    expect(dayKey(mondayFirst.to)).toBe('2026-12-07');

    const sundayFirst = buildMonthGrid(dayjs('2026-11-15'), 0);
    expect(sundayFirst.weeks).toHaveLength(5);
    expect(dayKey(sundayFirst.weeks[0][0])).toBe('2026-11-01');
    expect(dayKey(sundayFirst.weeks.at(-1)!.at(-1)!)).toBe('2026-12-05');
  });

  it('never exceeds the six weeks the server accepts', () => {
    for (let month = 0; month < 24; month++) {
      const grid = buildMonthGrid(dayjs('2026-01-01').add(month, 'month'), 1);
      expect(grid.weeks.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('resolveWeekStart', () => {
  it('starts on Sunday for en-US and on Monday for zh-CN', () => {
    expect(resolveWeekStart('en-US')).toBe(0);
    expect(resolveWeekStart('zh-CN')).toBe(1);
    expect(resolveWeekStart('de-DE')).toBe(1);
  });
});

describe('toCalendarRunOutcome', () => {
  it('reads success, failure, skip and running off the run status', () => {
    expect(toCalendarRunOutcome('completed')).toBe('succeeded');
    expect(toCalendarRunOutcome('failed')).toBe('failed');
    expect(toCalendarRunOutcome('timeout')).toBe('failed');
    expect(toCalendarRunOutcome('canceled')).toBe('skipped');
    expect(toCalendarRunOutcome('device_offline')).toBe('skipped');
    expect(toCalendarRunOutcome('running')).toBe('running');
  });
});

describe('expandPlannedRuns', () => {
  const daily = task({
    automationMode: 'schedule',
    schedulePattern: '0 9 * * *',
    scheduleTimezone: 'Asia/Shanghai',
  });

  it('expands a cron schedule in its own timezone, from now to the end of the grid', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    const runs = expandPlannedRuns(daily, NOVEMBER_UTC, now);

    // 09:00 Shanghai is 01:00 UTC; the 27th's slot has already passed.
    expect(runs.map((at) => at.toISOString())).toEqual([
      '2026-11-28T01:00:00.000Z',
      '2026-11-29T01:00:00.000Z',
      '2026-11-30T01:00:00.000Z',
    ]);
  });

  it('starts at the grid for a future month and plans nothing for a past one', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    expect(expandPlannedRuns(daily, NOVEMBER_UTC, now)).toHaveLength(30);
    expect(expandPlannedRuns(daily, NOVEMBER_UTC, new Date('2026-12-05T00:00:00Z'))).toEqual([]);
  });

  it('plans nothing while the schedule is held', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(expandPlannedRuns({ ...daily, status: 'paused' }, NOVEMBER_UTC, now)).toEqual([]);
    expect(expandPlannedRuns({ ...daily, awaitingHuman: true }, NOVEMBER_UTC, now)).toEqual([]);
    expect(
      expandPlannedRuns(
        { ...daily, context: { scheduler: { consecutiveFailures: 3 } } },
        NOVEMBER_UTC,
        now,
      ),
    ).toEqual([]);
  });

  it('keeps the later slots of a task with a run in flight', () => {
    const now = new Date('2026-11-29T12:00:00Z');
    const runs = expandPlannedRuns({ ...daily, status: 'running' }, NOVEMBER_UTC, now);
    expect(runs.map((at) => at.toISOString())).toEqual(['2026-11-30T01:00:00.000Z']);
  });

  it('steps a heartbeat by its interval from the pending tick', () => {
    const now = new Date('2026-11-30T20:00:00Z');
    const runs = expandPlannedRuns(
      task({
        automationMode: 'heartbeat',
        heartbeatInterval: 3600,
        lastHeartbeatAt: new Date('2026-11-30T19:30:00Z'),
      }),
      NOVEMBER_UTC,
      now,
    );
    expect(runs.map((at) => at.toISOString())).toEqual([
      '2026-11-30T20:30:00.000Z',
      '2026-11-30T21:30:00.000Z',
      '2026-11-30T22:30:00.000Z',
      '2026-11-30T23:30:00.000Z',
    ]);
  });

  it('caps a dense cadence', () => {
    const minutely = task({ automationMode: 'schedule', schedulePattern: '* * * * *' });
    const runs = expandPlannedRuns(minutely, NOVEMBER_UTC, new Date('2026-10-01T00:00:00Z'));
    expect(runs).toHaveLength(MAX_PLANNED_PER_TASK);
  });

  it('plans nothing for an invalid pattern', () => {
    const broken = task({ automationMode: 'schedule', schedulePattern: 'nope' });
    expect(expandPlannedRuns(broken, NOVEMBER_UTC, new Date('2026-11-01T00:00:00Z'))).toEqual([]);
  });
});

describe('collectScheduledEntries', () => {
  it('places past runs with their outcome and note, and future runs as planned', () => {
    const digest = task({
      automationMode: 'schedule',
      rangeRuns: [
        run({ createdAt: new Date('2026-11-02T09:00:00Z'), note: 'Inbox zero by 9:04' }),
        run({ createdAt: new Date('2026-11-03T09:00:00Z'), seq: 2, status: 'failed' }),
        // Outside the grid: the server window and the grid can disagree by a day.
        run({ createdAt: new Date('2026-12-02T09:00:00Z'), seq: 3 }),
      ],
      schedulePattern: '0 9 * * *',
      scheduleTimezone: 'UTC',
    });

    const entries = collectScheduledEntries(
      [digest],
      NOVEMBER_UTC,
      new Date('2026-11-29T10:00:00Z'),
    );

    expect(entries.map((entry) => [entry.kind, entry.at.toISOString()])).toEqual([
      ['run', '2026-11-02T09:00:00.000Z'],
      ['run', '2026-11-03T09:00:00.000Z'],
      ['planned', '2026-11-30T09:00:00.000Z'],
    ]);
    expect(entries[0]).toMatchObject({ outcome: 'succeeded', run: { note: 'Inbox zero by 9:04' } });
    expect(entries[1]).toMatchObject({ outcome: 'failed' });
  });
});

describe('collectCompletedEntries', () => {
  it('places completed tasks on their completion day and leaves undated tasks out', () => {
    const entries = collectCompletedEntries(
      [
        task({ completedAt: new Date('2026-11-05T10:00:00Z'), id: 'done', status: 'completed' }),
        task({ id: 'open', status: 'backlog' }),
        task({ completedAt: new Date('2026-10-05T10:00:00Z'), id: 'old', status: 'completed' }),
        // Reopened after completing: the stale stamp is not its day any more.
        task({ completedAt: new Date('2026-11-06T10:00:00Z'), id: 'reopened', status: 'running' }),
      ],
      NOVEMBER_UTC,
    );

    expect(entries.map((entry) => entry.task.id)).toEqual(['done']);
  });
});

describe('groupEntriesByDay', () => {
  it('groups by local day in time order', () => {
    const a = dayjs('2026-11-02T15:00');
    const b = dayjs('2026-11-02T08:00');
    const c = dayjs('2026-11-03T08:00');
    const byDay = groupEntriesByDay([
      { at: a.toDate(), kind: 'planned', task: task({ id: 'a' }) },
      { at: c.toDate(), kind: 'planned', task: task({ id: 'c' }) },
      { at: b.toDate(), kind: 'planned', task: task({ id: 'b' }) },
    ]);

    expect(byDay.get('2026-11-02')?.map((entry) => entry.task.id)).toEqual(['b', 'a']);
    expect(byDay.get('2026-11-03')?.map((entry) => entry.task.id)).toEqual(['c']);
  });
});
