import { describe, expect, it } from 'vitest';

import type { MentionCategory, MentionCategoryId } from './MentionMenu/types';
import { limitMentionGroups, mergeIntoCategory } from './mentionMenuSections';

const category = (id: MentionCategoryId, count: number): MentionCategory => ({
  icon: null,
  id,
  items: Array.from({ length: count }, (_, i) => ({ key: `${id}-${i}`, label: `${id} ${i}` })),
  label: id,
});

const keysById = (categories: MentionCategory[]) =>
  Object.fromEntries(categories.map((c) => [c.id, c.items.map((item) => item.key)]));

describe('limitMentionGroups', () => {
  it('shares one budget across the agent sections and caps skills', () => {
    const result = limitMentionGroups(
      [
        category('agent-private', 1),
        category('agent-workspace', 5),
        category('topic', 6),
        category('skill', 5),
        category('tool', 4),
      ],
      3,
    );

    expect(keysById(result)).toEqual({
      'agent-private': ['agent-private-0'],
      'agent-workspace': ['agent-workspace-0', 'agent-workspace-1'],
      'skill': ['skill-0', 'skill-1', 'skill-2'],
      'tool': ['tool-0', 'tool-1', 'tool-2', 'tool-3'],
      'topic': ['topic-0', 'topic-1', 'topic-2', 'topic-3', 'topic-4', 'topic-5'],
    });
  });

  it('drops a section the budget never reached instead of rendering it empty', () => {
    const result = limitMentionGroups(
      [category('agent-private', 3), category('agent-workspace', 2)],
      3,
    );

    expect(result.map((c) => c.id)).toEqual(['agent-private']);
  });
});

describe('mergeIntoCategory', () => {
  it('appends entries to the existing section without duplicates', () => {
    const result = mergeIntoCategory(
      [category('agent', 1)],
      {
        ...category('agent', 0),
        items: [
          { key: 'agent-0', label: 'dup' },
          { key: 'remote', label: 'remote' },
        ],
      },
      [],
    );

    expect(keysById(result)).toEqual({ agent: ['agent-0', 'remote'] });
  });

  it('creates a missing section after the last listed sibling', () => {
    const result = mergeIntoCategory(
      [category('agent', 1), category('topic', 1), category('tool', 1)],
      { ...category('skill', 0), items: [{ key: 'remote', label: 'remote' }] },
      ['agent', 'member', 'topic'],
    );

    expect(result.map((c) => c.id)).toEqual(['agent', 'topic', 'skill', 'tool']);
  });
});
