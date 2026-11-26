import { describe, expect, it } from 'vitest';

import { skillStatKeys } from './SkillStats';

describe('skillStatKeys', () => {
  it('leaves out every figure that is zero or missing', () => {
    expect(
      skillStatKeys({
        commentCount: 0,
        installCount: 78,
        ratingAverage: 0,
        ratingCount: 0,
        stars: 0,
      }),
    ).toEqual(['installs']);
  });

  it('shows the rating only once the skill has one', () => {
    expect(skillStatKeys({ ratingAverage: 4.5, ratingCount: 2 })).toEqual(['rating']);
    expect(skillStatKeys({ ratingAverage: 4.5, ratingCount: 0 })).toEqual([]);
  });

  it('keeps the strip order: rating, installs, stars, reviews, category, version', () => {
    expect(
      skillStatKeys({
        category: 'productivity',
        commentCount: 3,
        installCount: 9,
        ratingAverage: 4,
        ratingCount: 3,
        stars: 12,
        version: '1.0.0',
      }),
    ).toEqual(['rating', 'installs', 'stars', 'reviews', 'category', 'version']);
  });
});
