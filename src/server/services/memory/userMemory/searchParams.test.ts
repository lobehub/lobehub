import { describe, expect, it } from 'vitest';

import { normalizeSearchMemoryParams, resolveTimeIntent } from './searchParams';

describe('searchParams', () => {
  const now = new Date('2026-03-30T10:15:00.000Z');

  describe('resolveTimeIntent', () => {
    it('resolves preset selectors to UTC day boundaries', () => {
      expect(resolveTimeIntent({ selector: 'today' }, now)).toEqual({
        end: new Date('2026-03-30T23:59:59.999Z'),
        field: 'createdAt',
        start: new Date('2026-03-30T00:00:00.000Z'),
      });
      expect(resolveTimeIntent({ selector: 'yesterday' }, now)).toEqual({
        end: new Date('2026-03-29T23:59:59.999Z'),
        field: 'createdAt',
        start: new Date('2026-03-29T00:00:00.000Z'),
      });
    });

    it('resolves relative offsets from the selected anchor', () => {
      expect(
        resolveTimeIntent({ anchor: 'yesterday', offsetDays: -2, selector: 'relativeDay' }, now),
      ).toEqual({
        end: new Date('2026-03-27T23:59:59.999Z'),
        field: 'createdAt',
        start: new Date('2026-03-27T00:00:00.000Z'),
      });
    });

    it('resolves relative offsets from a concrete anchor day intent', () => {
      expect(
        resolveTimeIntent(
          {
            anchor: { date: new Date('2025-12-15T00:00:00.000Z'), selector: 'day' },
            offsetDays: 3,
            selector: 'relativeDay',
          },
          now,
        ),
      ).toEqual({
        end: new Date('2025-12-18T23:59:59.999Z'),
        field: 'createdAt',
        start: new Date('2025-12-18T00:00:00.000Z'),
      });
    });

    it('resolves relative offsets from another range-based selector using its start boundary', () => {
      expect(
        resolveTimeIntent(
          {
            anchor: { month: 12, selector: 'month', year: 2025 },
            offsetDays: 2,
            selector: 'relativeDay',
          },
          now,
        ),
      ).toEqual({
        end: new Date('2025-12-03T23:59:59.999Z'),
        field: 'createdAt',
        start: new Date('2025-12-03T00:00:00.000Z'),
      });
    });

    it('normalizes explicit ranges to full UTC day bounds', () => {
      expect(
        resolveTimeIntent(
          {
            end: new Date('2026-02-05T06:00:00.000Z'),
            selector: 'range',
            start: new Date('2026-02-03T18:30:00.000Z'),
          },
          now,
        ),
      ).toEqual({
        end: new Date('2026-02-05T23:59:59.999Z'),
        field: 'createdAt',
        start: new Date('2026-02-03T00:00:00.000Z'),
      });
    });
  });

  describe('normalizeSearchMemoryParams', () => {
    it('fills timeRange from timeIntent and clears timeIntent', () => {
      expect(
        normalizeSearchMemoryParams(
          {
            queries: ['atlas'],
            timeIntent: { selector: 'lastWeek' },
          },
          now,
        ),
      ).toEqual({
        queries: ['atlas'],
        timeIntent: undefined,
        timeRange: {
          end: new Date('2026-03-29T23:59:59.999Z'),
          field: 'createdAt',
          start: new Date('2026-03-23T00:00:00.000Z'),
        },
      });
    });

    it('preserves an existing timeRange without re-normalizing', () => {
      const params = {
        queries: ['atlas'],
        timeIntent: { selector: 'today' as const },
        timeRange: {
          end: new Date('2026-01-02T00:00:00.000Z'),
          start: new Date('2026-01-01T00:00:00.000Z'),
        },
      };

      expect(normalizeSearchMemoryParams(params, now)).toBe(params);
    });
  });
});
