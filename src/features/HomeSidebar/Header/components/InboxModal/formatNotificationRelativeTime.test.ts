import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { formatNotificationRelativeTime } from './formatNotificationRelativeTime';

dayjs.extend(relativeTime);

describe('formatNotificationRelativeTime', () => {
  beforeAll(async () => {
    await import('dayjs/locale/en');
    await import('dayjs/locale/zh-cn');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
  });

  afterAll(() => {
    dayjs.locale('en');
    vi.useRealTimers();
  });

  it('uses the requested English locale when the global locale is Chinese', () => {
    dayjs.locale('zh-cn');

    expect(formatNotificationRelativeTime('2026-07-16T10:00:00Z', 'en-US')).toBe('2 hours ago');
  });

  it('keeps Chinese relative dates for the Chinese UI', () => {
    expect(formatNotificationRelativeTime('2026-07-16T10:00:00Z', 'zh-CN')).toBe('2 小时前');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatNotificationRelativeTime('invalid date', 'en-US')).toBe('');
  });
});
