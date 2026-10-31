import { describe, expect, it } from 'vitest';

import { groupListSchema, listSchema, resolveClosedAfter } from './taskListSchemas';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('completedWithin', () => {
  it('is accepted by list and groupList, and rejects unknown windows', () => {
    expect(listSchema.parse({ completedWithin: 'week' }).completedWithin).toBe('week');
    expect(
      groupListSchema.parse({ completedWithin: 'day', groupBy: 'priority' }).completedWithin,
    ).toBe('day');
    expect(() => listSchema.parse({ completedWithin: 'year' })).toThrow();
  });

  it('resolves to the model cut relative to now', () => {
    const now = new Date('2026-03-10T12:00:00Z').getTime();

    expect(resolveClosedAfter('day', now)).toEqual(new Date(now - DAY_MS));
    expect(resolveClosedAfter('week', now)).toEqual(new Date(now - 7 * DAY_MS));
    expect(resolveClosedAfter('month', now)).toEqual(new Date(now - 30 * DAY_MS));
    expect(resolveClosedAfter(undefined, now)).toBeUndefined();
  });
});
