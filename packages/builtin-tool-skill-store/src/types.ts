export const SkillStoreIdentifier = 'lobe-skill-store';

export const SkillStoreApiName = {
  importFromMarket: 'importFromMarket',
  importSkill: 'importSkill',
  searchSkill: 'searchSkill',
};

export interface ImportSkillParams {
  type: 'url' | 'zip';
  url: string;
}

export interface ImportSkillState {
  name?: string;
  skillId?: string;
  status: 'created' | 'updated' | 'unchanged';
  success: boolean;
}

export interface SearchSkillParams {
  /**
   * Locale for search results (e.g., 'en-US', 'zh-CN')
   */
  locale?: string;
  /**
   * Sort order: 'asc' or 'desc'
   */
  order?: 'asc' | 'desc';
  /**
   * Page number (default: 1)
   */
  page?: number;
  /**
   * Page size (default: 20)
   */
  pageSize?: number;
  /**
   * Search query (searches name, description, summary)
   */
  q?: string;
  /**
   * Sort field: createdAt | installCount | forks | name | relevance | stars | updatedAt | watchers
   */
  sort?:
    | 'createdAt'
    | 'forks'
    | 'installCount'
    | 'name'
    | 'relevance'
    | 'stars'
    | 'updatedAt'
    | 'watchers';
}

export interface MarketSkillItem {
  category?: string;
  createdAt: string;
  description: string;
  identifier: string;
  installCount: number;
  name: string;
  repository?: string;
  sourceUrl?: string;
  summary?: string;
  updatedAt: string;
  version?: string;
}

export interface SearchSkillState {
  items: MarketSkillItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ImportFromMarketParams {
  /**
   * The identifier of the skill to import from market
   */
  identifier: string;
}

export interface ImportFromMarketState {
  name?: string;
  skillId?: string;
  status: 'created' | 'updated' | 'unchanged';
  success: boolean;
}
