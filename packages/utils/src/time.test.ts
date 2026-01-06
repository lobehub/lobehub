import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  daysAgo,
  getYYYYmmddHHMMss,
  hoursAgo,
  isNewReleaseDate,
  lastMonth,
  monthsAgo,
  thisMonth,
  thisQuarter,
  thisWeek,
  thisYear,
  today,
  weeksAgo,
} from './time';

describe('time utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed date for consistent testing: 2024-06-15 14:30:45 (local time)
    vi.setSystemTime(new Date('2024-06-15T14:30:45.123'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('today', () => {
    it('should return the start of the current day', () => {
      const result = today();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-15 00:00:00');
    });
  });

  describe('thisWeek', () => {
    it('should return the start of the current week', () => {
      const result = thisWeek();

      // dayjs starts week on Sunday by default
      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-09 00:00:00');
    });
  });

  describe('thisMonth', () => {
    it('should return the start of the current month', () => {
      const result = thisMonth();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-01 00:00:00');
    });
  });

  describe('thisQuarter', () => {
    it('should return the start of the current quarter (Q2)', () => {
      const result = thisQuarter();

      // June is in Q2, which starts in April (month 3, 0-indexed)
      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-04-01 00:00:00');
    });

    it('should work correctly for Q1 (January)', () => {
      vi.setSystemTime(new Date('2024-01-15T14:30:45.123'));
      const result = thisQuarter();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-01-01 00:00:00');
    });

    it('should work correctly for Q3 (September)', () => {
      vi.setSystemTime(new Date('2024-09-15T14:30:45.123'));
      const result = thisQuarter();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-07-01 00:00:00');
    });

    it('should work correctly for Q4 (December)', () => {
      vi.setSystemTime(new Date('2024-12-15T14:30:45.123'));
      const result = thisQuarter();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-10-01 00:00:00');
    });
  });

  describe('thisYear', () => {
    it('should return the start of the current year', () => {
      const result = thisYear();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-01-01 00:00:00');
    });
  });

  describe('hoursAgo', () => {
    it('should return the correct time hours ago', () => {
      const result = hoursAgo(3);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-15 11:00:00');
    });

    it('should handle 0 hours ago', () => {
      const result = hoursAgo(0);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-15 14:00:00');
    });

    it('should handle large hour values (cross day boundary)', () => {
      const result = hoursAgo(25);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-14 13:00:00');
    });
  });

  describe('daysAgo', () => {
    it('should return the correct date days ago', () => {
      const result = daysAgo(7);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-08 00:00:00');
    });

    it('should handle 0 days ago (today)', () => {
      const result = daysAgo(0);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-15 00:00:00');
    });

    it('should handle large day values (cross month boundary)', () => {
      const result = daysAgo(30);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-05-16 00:00:00');
    });
  });

  describe('weeksAgo', () => {
    it('should return the correct week weeks ago', () => {
      const result = weeksAgo(2);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-05-26 00:00:00');
    });

    it('should handle 0 weeks ago (this week)', () => {
      const result = weeksAgo(0);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-09 00:00:00');
    });
  });

  describe('monthsAgo', () => {
    it('should return the correct month months ago', () => {
      const result = monthsAgo(3);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-03-01 00:00:00');
    });

    it('should handle 0 months ago (this month)', () => {
      const result = monthsAgo(0);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-06-01 00:00:00');
    });

    it('should handle cross year boundary', () => {
      const result = monthsAgo(12);

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2023-06-01 00:00:00');
    });
  });

  describe('lastMonth', () => {
    it('should return the end of last month', () => {
      const result = lastMonth();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-05-31 23:59:59');
    });

    it('should work correctly for January (December of previous year)', () => {
      vi.setSystemTime(new Date('2024-01-15T14:30:45.123'));
      const result = lastMonth();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2023-12-31 23:59:59');
    });

    it('should work correctly for March (February with 29 days in leap year)', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:45.123'));
      const result = lastMonth();

      expect(result.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-02-29 23:59:59');
    });
  });

  describe('getYYYYmmddHHMMss', () => {
    it('should format date to YYYYMMDD_HHmmss format', () => {
      const date = new Date('2024-01-01T23:59:59.123');
      const result = getYYYYmmddHHMMss(date);

      expect(result).toBe('20240101_235959');
    });

    it('should format date with zero padding', () => {
      const date = new Date('2024-02-05T01:02:03.456');
      const result = getYYYYmmddHHMMss(date);

      expect(result).toBe('20240205_010203');
    });

    it('should handle end of year date', () => {
      const date = new Date('2024-12-31T00:00:00.000');
      const result = getYYYYmmddHHMMss(date);

      expect(result).toBe('20241231_000000');
    });

    it('should handle leap year date', () => {
      const date = new Date('2024-02-29T12:30:45.789');
      const result = getYYYYmmddHHMMss(date);

      expect(result).toBe('20240229_123045');
    });

    it('should work with the current mocked time', () => {
      const date = new Date('2024-06-15T14:30:45.123');
      const result = getYYYYmmddHHMMss(date);

      expect(result).toBe('20240615_143045');
    });
  });

  describe('edge cases and integration', () => {
    it('should all return dayjs objects for date functions', () => {
      expect(dayjs.isDayjs(today())).toBe(true);
      expect(dayjs.isDayjs(thisWeek())).toBe(true);
      expect(dayjs.isDayjs(thisMonth())).toBe(true);
      expect(dayjs.isDayjs(thisQuarter())).toBe(true);
      expect(dayjs.isDayjs(thisYear())).toBe(true);
      expect(dayjs.isDayjs(hoursAgo(1))).toBe(true);
      expect(dayjs.isDayjs(daysAgo(1))).toBe(true);
      expect(dayjs.isDayjs(weeksAgo(1))).toBe(true);
      expect(dayjs.isDayjs(monthsAgo(1))).toBe(true);
      expect(dayjs.isDayjs(lastMonth())).toBe(true);
    });

    it('should maintain consistency between different time functions', () => {
      const todayResult = today();
      const daysAgoResult = daysAgo(0);

      expect(todayResult.format('YYYY-MM-DD')).toBe(daysAgoResult.format('YYYY-MM-DD'));
    });

    it('should work with different time zones in getYYYYmmddHHMMss', () => {
      // Note: dayjs uses the local timezone by default
      const localDate = new Date('2024-06-15T14:30:45.000');
      const result = getYYYYmmddHHMMss(localDate);

      // The exact result depends on the test environment's timezone
      // But it should always be a valid format
      expect(result).toMatch(/^\d{8}_\d{6}$/);
      expect(result).toHaveLength(15);
      // Should match the local time format
      expect(result).toBe('20240615_143045');
    });
  });

  describe('isNewReleaseDate', () => {
    it('should return true if date is within 14 days', () => {
      const date = '2024-06-15'; // 0 days before 2024-06-15
      expect(isNewReleaseDate(date)).toBe(true);
    });

    it('should return true if date is exactly 13 days ago', () => {
      const date = '2024-06-02'; // 13 days before 2024-06-15
      expect(isNewReleaseDate(date)).toBe(true);
    });

    it('should return false if date is 15 days ago', () => {
      const date = '2024-05-31'; // 15 days before 2024-06-15
      expect(isNewReleaseDate(date)).toBe(false);
    });

    it('should return true if date is in future', () => {
      const date = '2024-06-16'; // 1 day after 2024-06-15
      expect(isNewReleaseDate(date)).toBe(true);
    });

    it('should work with real model release date (gemini-3-pro-preview)', () => {
      // Released at 2025-11-18, system time is 2024-06-15, so it's in future
      const date = '2025-11-18';
      expect(isNewReleaseDate(date)).toBe(true);
    });

    it('should work with custom days', () => {
      const date = '2024-06-09'; // 6 days ago from 2024-06-15
      expect(isNewReleaseDate(date, 7)).toBe(true);
      expect(isNewReleaseDate(date, 5)).toBe(false);
    });
  });
});
