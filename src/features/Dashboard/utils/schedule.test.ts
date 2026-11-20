import { describe, expect, it } from 'vitest';

import {
  boardSchedulePattern,
  findSchedulePreset,
  formatSchedule,
  initialBoardScheduleChoice,
  resolveBoardSchedule,
  scheduleShowsTimezone,
} from './schedule';

describe('findSchedulePreset', () => {
  it('names a preset regardless of spacing', () => {
    expect(findSchedulePreset('0 * * * *')).toBe('hourly');
    expect(findSchedulePreset('  */15  * * * * ')).toBe('every15m');
  });

  it('names nothing for other patterns or no schedule', () => {
    expect(findSchedulePreset('5 4 * * 1')).toBeUndefined();
    expect(findSchedulePreset(null)).toBeUndefined();
  });
});

describe('scheduleShowsTimezone', () => {
  it('drops the timezone for intervals only', () => {
    expect(scheduleShowsTimezone('0 * * * *')).toBe(false);
    expect(scheduleShowsTimezone('0 9 * * *')).toBe(true);
    expect(scheduleShowsTimezone('5 4 * * 1')).toBe(true);
  });
});

describe('resolveBoardSchedule', () => {
  it('has nothing to set without widgets the user can change', () => {
    expect(resolveBoardSchedule([])).toEqual({ kind: 'none' });
  });

  it('reads one shared cadence as a preset or as manual', () => {
    expect(
      resolveBoardSchedule([{ schedulePattern: '0 * * * *' }, { schedulePattern: '0  * * * *' }]),
    ).toEqual({ choice: 'hourly', kind: 'uniform' });
    expect(resolveBoardSchedule([{ schedulePattern: null }, {}])).toEqual({
      choice: 'manual',
      kind: 'uniform',
    });
  });

  it('keeps a shared custom pattern and differing cadences as they are', () => {
    const custom = resolveBoardSchedule([{ schedulePattern: '5 4 * * 1' }]);
    expect(custom).toEqual({ kind: 'custom', pattern: '5 4 * * 1' });
    expect(initialBoardScheduleChoice(custom)).toBe('keep');

    const mixed = resolveBoardSchedule([
      { schedulePattern: '0 * * * *' },
      { schedulePattern: null },
    ]);
    expect(mixed).toEqual({ kind: 'mixed' });
    expect(initialBoardScheduleChoice(mixed)).toBe('keep');
  });
});

describe('boardSchedulePattern', () => {
  it('writes a preset pattern, clears for manual and writes nothing to keep', () => {
    expect(boardSchedulePattern('every6h')).toBe('0 */6 * * *');
    expect(boardSchedulePattern('manual')).toBeNull();
    expect(boardSchedulePattern('keep')).toBeUndefined();
  });
});

describe('formatSchedule', () => {
  const translate = (key: string) => `t:${key}`;

  it('names presets and keeps the timezone only where it changes the run time', () => {
    expect(formatSchedule(translate, '0 * * * *', 'Asia/Shanghai')).toBe('t:schedule.hourly');
    expect(formatSchedule(translate, '0 9 * * *', 'Asia/Shanghai')).toBe(
      't:schedule.daily9 · Asia/Shanghai',
    );
    expect(formatSchedule(translate, '5 4 * * 1', null)).toBe('5 4 * * 1');
  });
});
