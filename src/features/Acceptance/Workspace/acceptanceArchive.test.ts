import { describe, expect, it } from 'vitest';

import { archiveDaysLeft } from './acceptanceArchive';

const DAY = 86_400_000;
const now = new Date('2026-09-13T12:00:00Z');

describe('archiveDaysLeft', () => {
  it('counts down from 30 in whole days', () => {
    expect(archiveDaysLeft(now, now)).toBe(30);
    expect(archiveDaysLeft(new Date(now.getTime() + 5 * DAY), now)).toBe(30);
    expect(archiveDaysLeft(new Date(now.getTime() - 3 * DAY), now)).toBe(27);
    expect(archiveDaysLeft(new Date(now.getTime() - 3.9 * DAY), now)).toBe(27);
  });

  it('never goes below zero once the retention window has passed', () => {
    expect(archiveDaysLeft(new Date(now.getTime() - 31 * DAY), now)).toBe(0);
    expect(archiveDaysLeft(new Date(now.getTime() - 400 * DAY).toISOString(), now)).toBe(0);
  });
});
