import { describe, expect, it } from 'vitest';

import { type AgentTemplate, MarketplaceCategory } from '../types';
import {
  getTemplatesByCategories,
  getTemplatesByCategoryPriority,
  normalizeAgentTemplate,
} from './agent-templates';

const fixture: AgentTemplate[] = [
  { category: MarketplaceCategory.PersonalLife, id: 'a', title: 'A' },
  { category: MarketplaceCategory.Engineering, id: 'b', title: 'B' },
  { category: MarketplaceCategory.ContentCreation, id: 'c', title: 'C' },
  { category: MarketplaceCategory.Engineering, id: 'd', title: 'D' },
];

describe('getTemplatesByCategoryPriority', () => {
  it('returns templates as-is when no hints are provided', () => {
    expect(getTemplatesByCategoryPriority(fixture, [])).toEqual(fixture);
  });

  it('moves hinted categories to the front in hint order while keeping all templates', () => {
    const result = getTemplatesByCategoryPriority(fixture, [
      MarketplaceCategory.Engineering,
      MarketplaceCategory.ContentCreation,
    ]);

    expect(result).toHaveLength(fixture.length);
    expect(result[0]?.category).toBe(MarketplaceCategory.Engineering);
    expect(result[1]?.category).toBe(MarketplaceCategory.Engineering);
    expect(result[2]?.category).toBe(MarketplaceCategory.ContentCreation);
    expect(result.some((t) => t.category === MarketplaceCategory.PersonalLife)).toBe(true);
  });
});

describe('getTemplatesByCategories', () => {
  it('returns all templates when no categories are provided', () => {
    expect(getTemplatesByCategories(fixture, [])).toEqual(fixture);
  });

  it('keeps only templates whose category matches the filter', () => {
    const result = getTemplatesByCategories(fixture, [MarketplaceCategory.Engineering]);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.category === MarketplaceCategory.Engineering)).toBe(true);
  });
});

describe('normalizeAgentTemplate', () => {
  it('maps an onboarding-full item using the outer category key', () => {
    const result = normalizeAgentTemplate(
      {
        avatar: 'https://example.com/avatar.webp',
        description: 'A senior code reviewer.',
        identifier: 'agent-template-code-reviewer',
        name: 'Code Reviewer',
      },
      'engineering',
    );

    expect(result).toEqual({
      avatar: 'https://example.com/avatar.webp',
      category: MarketplaceCategory.Engineering,
      description: 'A senior code reviewer.',
      id: 'agent-template-code-reviewer',
      title: 'Code Reviewer',
    });
  });

  it('returns undefined when the outer category is not in the enum', () => {
    expect(
      normalizeAgentTemplate(
        { identifier: 'agent-template-mystery', name: 'Mystery' },
        'unknown-bucket',
      ),
    ).toBeUndefined();
  });

  it('returns undefined when identifier or name is missing', () => {
    expect(
      normalizeAgentTemplate({ identifier: 'x' }, MarketplaceCategory.Engineering),
    ).toBeUndefined();
    expect(normalizeAgentTemplate({ name: 'X' }, MarketplaceCategory.Engineering)).toBeUndefined();
  });
});
