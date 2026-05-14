import dayjs from 'dayjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatTaskItemDate } from './formatTaskItemDate';

describe('formatTaskItemDate', () => {
  it('formats current-year dates with day precision', () => {
    expect(formatTaskItemDate('2026-04-24', { now: '2026-05-01' })).toBe('Apr 24');
  });

  it('formats dates from other years with the year included', () => {
    expect(formatTaskItemDate('2025-04-24', { now: '2026-05-01' })).toBe('Apr 24, 2025');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatTaskItemDate()).toBe('');
    expect(formatTaskItemDate('invalid date')).toBe('');
  });

  describe('with explicit locale', () => {
    beforeAll(async () => {
      await import('dayjs/locale/zh-cn');
      await import('dayjs/locale/en');
      // Simulate the regression: dayjs's global locale stuck on zh-cn while the
      // caller wants English output.
      dayjs.locale('zh-cn');
    });

    afterAll(() => {
      dayjs.locale('en');
    });

    it('renders English month names when locale is en-US, regardless of dayjs global', () => {
      expect(formatTaskItemDate('2026-05-12', { locale: 'en-US', now: '2026-05-20' })).toBe(
        'May 12',
      );
    });

    it('renders Chinese month names when locale is zh-CN with a Chinese format string', () => {
      expect(
        formatTaskItemDate('2026-05-12', {
          formatThisYear: 'M月D日',
          locale: 'zh-CN',
          now: '2026-05-20',
        }),
      ).toBe('5月12日');
    });
  });
});
