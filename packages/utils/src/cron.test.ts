import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { buildCronPattern, formatScheduleTime, parseCronPattern, WEEKDAY_I18N_KEYS } from './cron';

describe('parseCronPattern', () => {
  describe('daily', () => {
    it('parses every-day-at-9am', () => {
      expect(parseCronPattern('0 9 * * *')).toEqual({
        scheduleType: 'daily',
        triggerHour: 9,
        triggerMinute: 0,
      });
    });

    it('parses 7:30am (minute=30 stays 30 after normalization)', () => {
      expect(parseCronPattern('30 7 * * *')).toEqual({
        scheduleType: 'daily',
        triggerHour: 7,
        triggerMinute: 30,
      });
    });

    it('parses evening hour', () => {
      expect(parseCronPattern('0 19 * * *')).toEqual({
        scheduleType: 'daily',
        triggerHour: 19,
        triggerMinute: 0,
      });
    });
  });

  describe('weekly', () => {
    it('parses single weekday (Monday)', () => {
      expect(parseCronPattern('0 9 * * 1')).toEqual({
        scheduleType: 'weekly',
        triggerHour: 9,
        triggerMinute: 0,
        weekdays: [1],
      });
    });

    it('parses Friday afternoon', () => {
      expect(parseCronPattern('0 15 * * 5')).toEqual({
        scheduleType: 'weekly',
        triggerHour: 15,
        triggerMinute: 0,
        weekdays: [5],
      });
    });

    it('parses comma-separated weekdays', () => {
      expect(parseCronPattern('0 9 * * 1,3,5')).toEqual({
        scheduleType: 'weekly',
        triggerHour: 9,
        triggerMinute: 0,
        weekdays: [1, 3, 5],
      });
    });
  });

  describe('hourly', () => {
    it('parses every-hour (*)', () => {
      expect(parseCronPattern('0 * * * *')).toEqual({
        hourlyInterval: 1,
        scheduleType: 'hourly',
        triggerHour: 0,
        triggerMinute: 0,
      });
    });

    it('parses every-N-hours (*/N)', () => {
      expect(parseCronPattern('0 */6 * * *')).toEqual({
        hourlyInterval: 6,
        scheduleType: 'hourly',
        triggerHour: 0,
        triggerMinute: 0,
      });
    });
  });

  describe('minute normalization', () => {
    it.each([
      [0, 0],
      [14, 0],
      [15, 30],
      [29, 30],
      [30, 30],
      [44, 30],
      [45, 0],
      [59, 0],
    ])('normalizes minute %i to %i', (input, expected) => {
      const parsed = parseCronPattern(`${input} 9 * * *`);
      expect(parsed.triggerMinute).toBe(expected);
    });
  });

  describe('fallback', () => {
    it.each([
      ['empty', ''],
      ['too few fields', '0 9 * *'],
      ['too many fields', '0 9 * * * *'],
    ])('falls back to daily 0:00 for %s', (_label, cron) => {
      expect(parseCronPattern(cron)).toEqual({
        scheduleType: 'daily',
        triggerHour: 0,
        triggerMinute: 0,
      });
    });
  });
});

describe('buildCronPattern', () => {
  const at = (h: number, m: number) => dayjs().hour(h).minute(m);

  it('builds daily pattern', () => {
    expect(buildCronPattern('daily', at(9, 0))).toBe('0 9 * * *');
    expect(buildCronPattern('daily', at(7, 30))).toBe('30 7 * * *');
  });

  it('builds weekly pattern with weekdays', () => {
    expect(buildCronPattern('weekly', at(9, 0), undefined, [1])).toBe('0 9 * * 1');
    expect(buildCronPattern('weekly', at(10, 0), undefined, [5, 1, 3])).toBe('0 10 * * 1,3,5');
  });

  it('builds weekly with all weekdays when none specified', () => {
    expect(buildCronPattern('weekly', at(9, 0))).toBe('0 9 * * 0,1,2,3,4,5,6');
  });

  it('builds hourly pattern with interval 1 as star', () => {
    expect(buildCronPattern('hourly', at(0, 0), 1)).toBe('0 * * * *');
  });

  it('builds hourly pattern with N-interval', () => {
    expect(buildCronPattern('hourly', at(0, 30), 6)).toBe('30 */6 * * *');
  });

  it('normalizes raw minutes to 0 or 30', () => {
    expect(buildCronPattern('daily', at(9, 14))).toBe('0 9 * * *');
    expect(buildCronPattern('daily', at(9, 20))).toBe('30 9 * * *');
    expect(buildCronPattern('daily', at(9, 50))).toBe('0 9 * * *');
  });
});

describe('formatScheduleTime', () => {
  it('zero-pads hours and minutes', () => {
    expect(formatScheduleTime(9, 0)).toBe('09:00');
    expect(formatScheduleTime(7, 30)).toBe('07:30');
    expect(formatScheduleTime(15, 5)).toBe('15:05');
    expect(formatScheduleTime(0, 0)).toBe('00:00');
  });
});

describe('WEEKDAY_I18N_KEYS', () => {
  it('orders Sunday-first to match cron weekday numbering', () => {
    expect(WEEKDAY_I18N_KEYS[0]).toBe('sunday');
    expect(WEEKDAY_I18N_KEYS[1]).toBe('monday');
    expect(WEEKDAY_I18N_KEYS[6]).toBe('saturday');
  });
});
