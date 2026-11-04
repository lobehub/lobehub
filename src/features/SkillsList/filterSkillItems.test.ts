import { describe, expect, it } from 'vitest';

import { filterSkillItems } from './filterSkillItems';

const items = [
  { description: 'Query PostgreSQL databases', id: 'access-pg', name: 'access-pg' },
  { id: 'add-model', name: 'add-model' },
];

describe('filterSkillItems', () => {
  it('returns the same list for a blank query', () => {
    expect(filterSkillItems(items, '   ')).toBe(items);
  });

  it('matches the name case-insensitively and ignores surrounding spaces', () => {
    expect(filterSkillItems(items, ' ADD-MO ').map((item) => item.id)).toEqual(['add-model']);
  });

  it('matches the description', () => {
    expect(filterSkillItems(items, 'postgres').map((item) => item.id)).toEqual(['access-pg']);
  });

  it('returns nothing when no skill matches', () => {
    expect(filterSkillItems(items, 'nope')).toEqual([]);
  });
});
