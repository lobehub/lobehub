import {
  type AgentTemplate,
  MarketplaceCategory,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { describe, expect, it } from 'vitest';

import {
  fromCommunity,
  groupTemplates,
  isMarketplaceCategory,
  matchAgent,
  pickFeatured,
} from './marketAgentCatalog';

const template = (
  id: string,
  category: MarketplaceCategory,
  forkCount = 0,
  description = '',
): AgentTemplate => ({ category, description, forkCount, id, title: id });

describe('marketAgentCatalog', () => {
  const templates = [
    template('chef', MarketplaceCategory.PersonalLife, 50),
    template('release', MarketplaceCategory.ProductManagement, 900),
    template('roadmap', MarketplaceCategory.ProductManagement, 800),
    template('reviewer', MarketplaceCategory.Engineering, 700, 'finds bugs in code'),
    template('notes', MarketplaceCategory.Operations, 10),
  ];

  it('groups by category with work first and life last, skipping empty categories', () => {
    expect(groupTemplates(templates).map((group) => group.category)).toEqual([
      MarketplaceCategory.ProductManagement,
      MarketplaceCategory.Operations,
      MarketplaceCategory.Engineering,
      MarketplaceCategory.PersonalLife,
    ]);
  });

  it('features the most-added assistants, one per category', () => {
    expect(pickFeatured(templates).map((agent) => agent.id)).toEqual([
      'release',
      'reviewer',
      'chef',
    ]);
  });

  it('matches the name or the description', () => {
    const [reviewer] = groupTemplates([templates[3]])[0].items;
    expect(matchAgent(reviewer, 'BUGS')).toBe(true);
    expect(matchAgent(reviewer, 'review')).toBe(true);
    expect(matchAgent(reviewer, 'chef')).toBe(false);
  });

  it('names a community agent by its identifier when it has no title', () => {
    expect(fromCommunity({ identifier: 'abc' } as any)).toMatchObject({ id: 'abc', title: 'abc' });
  });

  it('tells a curated category from a community one', () => {
    expect(isMarketplaceCategory('engineering')).toBe(true);
    expect(isMarketplaceCategory('programming')).toBe(false);
    expect(isMarketplaceCategory(undefined)).toBe(false);
  });
});
