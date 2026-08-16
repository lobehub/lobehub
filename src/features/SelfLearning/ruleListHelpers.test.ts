import { describe, expect, it } from 'vitest';

import type { ExpertiseLessonItem } from '@/services/expertise';

import { groupLessons } from './ruleListHelpers';

const lesson = (id: string, hitCount: number, tier: string): ExpertiseLessonItem =>
  ({ hitCount, id, tier }) as ExpertiseLessonItem;

describe('groupLessons', () => {
  it('keeps only the five most-used lessons in compact mode', () => {
    const groups = groupLessons(
      [
        lesson('low', 1, 'core'),
        lesson('sixth', 5, 'niche'),
        lesson('first', 10, 'core'),
        lesson('third', 8, 'unused'),
        lesson('second', 9, 'niche'),
        lesson('fifth', 6, 'core'),
        lesson('fourth', 7, 'niche'),
      ],
      5,
    );

    const ids = groups.flatMap((group) => group.items.map((item) => item.id));
    expect(ids).toHaveLength(5);
    expect(ids).toEqual(expect.arrayContaining(['first', 'second', 'third', 'fourth', 'fifth']));
    expect(ids).not.toContain('sixth');
    expect(ids).not.toContain('low');
  });
});
