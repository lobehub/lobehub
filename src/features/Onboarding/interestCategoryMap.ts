import { MarketplaceCategory } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import type { InterestAreaKey } from '@lobechat/const';

const INTEREST_CATEGORY_MAP: Partial<Record<InterestAreaKey, MarketplaceCategory>> = {
  'business': MarketplaceCategory.BusinessStrategy,
  'coding': MarketplaceCategory.Engineering,
  'creator': MarketplaceCategory.CreatorEconomy,
  'design': MarketplaceCategory.DesignCreative,
  'education': MarketplaceCategory.LearningResearch,
  'finance-legal': MarketplaceCategory.FinanceLegal,
  'hr': MarketplaceCategory.PeopleHR,
  'investing': MarketplaceCategory.FinanceLegal,
  'marketing': MarketplaceCategory.Marketing,
  'operations': MarketplaceCategory.Operations,
  'personal': MarketplaceCategory.PersonalLife,
  'product': MarketplaceCategory.ProductManagement,
  'sales': MarketplaceCategory.SalesCustomer,
  'writing': MarketplaceCategory.ContentCreation,
};

export const interestsToCategoryHints = (interests: string[]): MarketplaceCategory[] => {
  const seen = new Set<MarketplaceCategory>();
  const hints: MarketplaceCategory[] = [];

  for (const interest of interests) {
    const category = INTEREST_CATEGORY_MAP[interest as InterestAreaKey];
    if (category && !seen.has(category)) {
      seen.add(category);
      hints.push(category);
    }
  }

  return hints;
};
