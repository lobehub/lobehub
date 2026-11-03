import { MarketplaceCategory } from '../../../types';

export const CATEGORY_LABEL_I18N_KEYS = {
  [MarketplaceCategory.BusinessStrategy]: 'agentMarketplace.category.businessStrategy',
  [MarketplaceCategory.ContentCreation]: 'agentMarketplace.category.contentCreation',
  [MarketplaceCategory.CreatorEconomy]: 'agentMarketplace.category.creatorEconomy',
  [MarketplaceCategory.DesignCreative]: 'agentMarketplace.category.designCreative',
  [MarketplaceCategory.Engineering]: 'agentMarketplace.category.engineering',
  [MarketplaceCategory.FinanceLegal]: 'agentMarketplace.category.financeLegal',
  [MarketplaceCategory.LearningResearch]: 'agentMarketplace.category.learningResearch',
  [MarketplaceCategory.Marketing]: 'agentMarketplace.category.marketing',
  [MarketplaceCategory.Operations]: 'agentMarketplace.category.operations',
  [MarketplaceCategory.PeopleHR]: 'agentMarketplace.category.peopleHR',
  [MarketplaceCategory.PersonalLife]: 'agentMarketplace.category.personalLife',
  [MarketplaceCategory.ProductManagement]: 'agentMarketplace.category.productManagement',
  [MarketplaceCategory.SalesCustomer]: 'agentMarketplace.category.salesCustomer',
} as const satisfies Record<MarketplaceCategory, string>;
