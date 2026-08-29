import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { resolveScheduleTime } from './scheduleTime';

describe('resolveScheduleTime', () => {
  it('lands on the hour instead of the minute the menu happened to open', () => {
    const now = dayjs('2026-07-13T12:35:00');

    expect(resolveScheduleTime(1, now).format('HH:mm')).toBe('13:00');
    expect(resolveScheduleTime(3, now).format('HH:mm')).toBe('15:00');
    expect(resolveScheduleTime(8, now).format('HH:mm')).toBe('20:00');
    expect(resolveScheduleTime(24, now).format('MM-DD HH:mm')).toBe('07-14 12:00');
  });

  it('takes the next hour when flooring would leave almost no lead time', () => {
    // 12:59 + 1h floored is 13:00 — 60 seconds away, which makes "in 1 hour" a lie.
    const now = dayjs('2026-07-13T12:59:00');

    expect(resolveScheduleTime(1, now).format('HH:mm')).toBe('14:00');
  });

  it('keeps the floored slot when it is comfortably ahead', () => {
    const now = dayjs('2026-07-13T12:45:00');

    expect(resolveScheduleTime(1, now).format('HH:mm')).toBe('13:00');
  });
});
