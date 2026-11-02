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

describe('filter', () => {
  const filter = {
    agent: { operator: 'isNot', values: ['agt_1', '__none__'] },
    completedAt: { operator: 'before', window: 'quarter' },
    content: '  menu ',
    priority: { operator: 'is', values: [0, 2] },
    status: { operator: 'is', values: ['backlog'] },
  } as const;

  it('is accepted by list and groupList', () => {
    expect(listSchema.parse({ filter }).filter).toEqual({ ...filter, content: 'menu' });
    expect(groupListSchema.parse({ filter, groupBy: 'priority' }).filter?.status).toEqual(
      filter.status,
    );
  });

  it('rejects malformed conditions', () => {
    expect(() =>
      listSchema.parse({ filter: { status: { operator: 'is', values: ['done'] } } }),
    ).toThrow();
    expect(() =>
      listSchema.parse({ filter: { priority: { operator: 'is', values: [5] } } }),
    ).toThrow();
    expect(() =>
      listSchema.parse({ filter: { status: { operator: 'is', values: [] } } }),
    ).toThrow();
    expect(() =>
      listSchema.parse({ filter: { createdAt: { operator: 'within', window: 'year' } } }),
    ).toThrow();
    expect(() =>
      listSchema.parse({ filter: { status: { operator: 'contains', values: ['backlog'] } } }),
    ).toThrow();
  });

  it('does not let a creator condition ask for "nobody"', () => {
    expect(() =>
      listSchema.parse({ filter: { creator: { operator: 'is', values: ['__none__'] } } }),
    ).toThrow();
  });
});
