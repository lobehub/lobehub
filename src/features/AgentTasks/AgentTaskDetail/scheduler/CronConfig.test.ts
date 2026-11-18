import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { buildCronPattern, getMinuteChoices, parseCronPattern } from './CronConfig';
import { formatScheduleDescription } from './helpers';

const time = (hour: number, minute: number) => dayjs().hour(hour).minute(minute);

describe('buildCronPattern', () => {
  it('keeps the exact minute for every frequency', () => {
    expect(buildCronPattern('daily', time(9, 17))).toBe('17 9 * * *');
    expect(buildCronPattern('weekly', time(9, 17), undefined, [1, 3])).toBe('17 9 * * 1,3');
    expect(buildCronPattern('hourly', time(0, 45))).toBe('45 * * * *');
    expect(buildCronPattern('hourly', time(0, 15), 2)).toBe('15 */2 * * *');
  });
});

describe('parseCronPattern', () => {
  it('reads the exact minute back', () => {
    expect(parseCronPattern('17 9 * * *')).toMatchObject({
      scheduleType: 'daily',
      triggerHour: 9,
      triggerMinute: 17,
    });
    expect(parseCronPattern('45 */2 * * *')).toMatchObject({
      hourlyInterval: 2,
      triggerMinute: 45,
    });
  });

  it('treats interval and any-minute fields as no fixed minute', () => {
    expect(parseCronPattern('*/15 * * * *').triggerMinute).toBe(0);
    expect(parseCronPattern('* 9 * * *').triggerMinute).toBe(0);
  });
});

describe('getMinuteChoices', () => {
  it('offers every minute with access', () => {
    const choices = getMinuteChoices(true, 0);
    expect(choices).toHaveLength(60);
    expect(choices[59]).toBe(59);
  });

  it('offers the standard minutes without access', () => {
    expect(getMinuteChoices(false, 30)).toEqual([0, 30]);
  });

  it('keeps a stored exact minute visible without access', () => {
    expect(getMinuteChoices(false, 17)).toEqual([0, 17, 30]);
  });
});

describe('formatScheduleDescription', () => {
  const t = ((key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key) as never;

  it('names the exact time for daily and weekly schedules', () => {
    expect(formatScheduleDescription('17 9 * * *', t)).toBe(
      'taskSchedule.summary.daily:{"time":"09:17"}',
    );
    expect(formatScheduleDescription('5 9 * * 1', t)).toContain('"time":"09:05"');
  });

  it('names an exact minute for hourly schedules', () => {
    expect(formatScheduleDescription('5 * * * *', t)).toBe(
      'taskSchedule.summary.hourlyAtMinute:{"minute":"05"}',
    );
    expect(formatScheduleDescription('45 */2 * * *', t)).toBe(
      'taskSchedule.summary.everyNHoursAtMinute:{"count":2,"minute":"45"}',
    );
  });

  it('keeps the existing wording for :00 and :30', () => {
    expect(formatScheduleDescription('0 * * * *', t)).toBe('taskSchedule.summary.hourly');
    expect(formatScheduleDescription('30 * * * *', t)).toBe('taskSchedule.summary.hourlyHalfPast');
  });
});
