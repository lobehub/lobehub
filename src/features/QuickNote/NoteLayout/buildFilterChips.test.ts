import { describe, expect, it } from 'vitest';

import { UNCATEGORIZED_KEY } from '@/store/quickNote';

import { buildFilterChips } from './buildFilterChips';

describe('buildFilterChips', () => {
  it('sorts collection and tag chips by count descending', () => {
    const { collectionChips, tagChips } = buildFilterChips({
      activeCollection: null,
      activeTag: null,
      allLabel: 'All notes',
      collections: [
        { count: 1, name: 'Tasks' },
        { count: 3, name: 'Research' },
      ],
      tags: [
        { count: 1, name: 'Idea' },
        { count: 2, name: 'Bug' },
      ],
      uncategorizedCount: 0,
      uncategorizedLabel: 'Uncategorized',
    });

    expect(collectionChips.map((chip) => chip.key)).toEqual(['all', 'Research', 'Tasks']);
    expect(tagChips.map((chip) => chip.key)).toEqual(['Bug', 'Idea']);
  });

  it('marks the All chip active when no collection or tag is selected', () => {
    const { collectionChips } = buildFilterChips({
      activeCollection: null,
      activeTag: null,
      allLabel: 'All notes',
      collections: [{ count: 1, name: 'Research' }],
      tags: [],
      uncategorizedCount: 0,
      uncategorizedLabel: 'Uncategorized',
    });

    expect(collectionChips.find((chip) => chip.key === 'all')?.active).toBe(true);
  });

  it('flags the active tag chip', () => {
    const { tagChips } = buildFilterChips({
      activeCollection: null,
      activeTag: 'Bug',
      allLabel: 'All notes',
      collections: [],
      tags: [
        { count: 2, name: 'Bug' },
        { count: 1, name: 'Idea' },
      ],
      uncategorizedCount: 0,
      uncategorizedLabel: 'Uncategorized',
    });

    expect(tagChips.find((chip) => chip.key === 'Bug')?.active).toBe(true);
    expect(tagChips.find((chip) => chip.key === 'Idea')?.active).toBe(false);
  });

  it('returns an empty tag chip list when there are no tags', () => {
    const { tagChips } = buildFilterChips({
      activeCollection: null,
      activeTag: null,
      allLabel: 'All notes',
      collections: [],
      tags: [],
      uncategorizedCount: 0,
      uncategorizedLabel: 'Uncategorized',
    });

    expect(tagChips).toEqual([]);
  });

  it('appends an uncategorized chip using the UNCATEGORIZED_KEY when notes are uncategorized', () => {
    const { collectionChips } = buildFilterChips({
      activeCollection: UNCATEGORIZED_KEY,
      activeTag: null,
      allLabel: 'All notes',
      collections: [],
      tags: [],
      uncategorizedCount: 2,
      uncategorizedLabel: 'Uncategorized',
    });

    const uncategorized = collectionChips.find((chip) => chip.key === UNCATEGORIZED_KEY);
    expect(uncategorized).toMatchObject({ active: true, count: 2, onSelect: 'uncategorized' });
  });
});
