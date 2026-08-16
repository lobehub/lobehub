import { describe, expect, it } from 'vitest';

import { recentLessonDelta } from './expertiseHelpers';

describe('recentLessonDelta', () => {
  it('uses zero as the baseline for the first practice', () => {
    expect(recentLessonDelta([{ n: 1, run: 1 }])).toBe(1);
  });

  it('reports recent net change after multiple practices', () => {
    expect(
      recentLessonDelta([
        { n: 2, run: 1 },
        { n: 4, run: 2 },
        { n: 3, run: 3 },
      ]),
    ).toBe(1);
  });
});
