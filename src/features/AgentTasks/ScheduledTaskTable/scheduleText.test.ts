import { describe, expect, it } from 'vitest';

import { formatElapsed, formatRelativeToNow, formatRunMoment } from './scheduleText';

// Local time, so "today" does not depend on the machine's timezone.
const NOW = new Date(2026, 10, 22, 12, 0, 0);
const options = { dateTimeFormat: 'MMM D HH:mm', locale: 'en-US', now: NOW };

describe('formatRunMoment', () => {
  it('shows the time alone for a moment today', () => {
    expect(formatRunMoment(new Date(2026, 10, 22, 14, 0), options)).toBe('14:00');
    expect(formatRunMoment(new Date(2026, 10, 22, 6, 5), options)).toBe('06:05');
  });

  it('adds the date for a moment on another day', () => {
    expect(formatRunMoment(new Date(2026, 10, 23, 6, 0), options)).toBe('Nov 23 06:00');
    expect(formatRunMoment(new Date(2026, 8, 14, 8, 0), options)).toBe('Sep 14 08:00');
  });

  it('reads an ISO string the same as a Date', () => {
    const moment = new Date(2026, 10, 22, 14, 0);
    expect(formatRunMoment(moment.toISOString(), options)).toBe('14:00');
  });
});

describe('formatRelativeToNow', () => {
  it('reads forward and backward from now', () => {
    expect(formatRelativeToNow(new Date(2026, 10, 22, 14, 0), NOW, 'en-US')).toBe('in 2 hours');
    expect(formatRelativeToNow(new Date(2026, 10, 19, 12, 0), NOW, 'en-US')).toBe('3 days ago');
  });
});

describe('formatElapsed', () => {
  it('drops the suffix', () => {
    expect(formatElapsed(new Date(2026, 10, 22, 11, 48), NOW, 'en-US')).toBe('12 minutes');
    expect(formatElapsed(new Date(2026, 8, 14, 12, 0), NOW, 'en-US')).toBe('2 months');
  });
});
