import { MarketplaceCategory } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { describe, expect, it } from 'vitest';

import { interestsToCategoryHints } from './interestCategoryMap';

describe('interestsToCategoryHints', () => {
  it('maps known interest keys to marketplace categories in order', () => {
    expect(interestsToCategoryHints(['coding', 'writing'])).toEqual([
      MarketplaceCategory.Engineering,
      MarketplaceCategory.ContentCreation,
    ]);
  });

  it('deduplicates categories that several interests map to', () => {
    expect(interestsToCategoryHints(['investing', 'finance-legal'])).toEqual([
      MarketplaceCategory.FinanceLegal,
    ]);
  });

  it('drops interests without a mapped category', () => {
    expect(interestsToCategoryHints(['health', 'hobbies', 'parenting'])).toEqual([]);
  });

  it('drops free-form custom interests', () => {
    expect(interestsToCategoryHints(['my own thing', 'coding'])).toEqual([
      MarketplaceCategory.Engineering,
    ]);
  });

  it('returns an empty list for no interests', () => {
    expect(interestsToCategoryHints([])).toEqual([]);
  });
});
