import { describe, expect, it } from 'vitest';

import { getLearnedGains } from './curveHelpers';

describe('getLearnedGains', () => {
  it('uses cumulative learned totals when active lessons decrease after retirement', () => {
    const gains = getLearnedGains([
      { learnedTotal: 2 },
      { learnedTotal: 4 },
      { learnedTotal: 4 },
      { learnedTotal: 5 },
    ]);

    expect(gains).toEqual([2, 2, 0, 1]);
  });
});
