export const SkillStoreIdentifier = 'lobe-skill-store';

export const SkillStoreApiName = {
  importFromMarket: 'importFromMarket',
  importSkill: 'importSkill',
  inspectSkill: 'inspectSkill',
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

export interface InspectSkillParams {
  /**
   * The identifier of the market skill to check before installing it
   */
  identifier: string;
}

/** One text file of a skill package, path relative to the package root. */
export interface SkillPackageFile {
  content: string;
  path: string;
}

/** An environment variable a skill reads or tells the user to set, and where. */
export interface SkillEnvVarUsage {
  files: string[];
  name: string;
}

/** A network host a skill's scripts contact, and where it appears. */
export interface SkillEndpointUsage {
  files: string[];
  host: string;
}

/**
 * What a skill needs, read from its own files rather than its author-written
 * description: a description can claim "no API key needed" while the scripts
 * read one and send data to a third-party API.
 */
export interface SkillRequirements {
  /** Credential-like environment variables (API keys, tokens, secrets) */
  credentials: SkillEnvVarUsage[];
  /** Network hosts referenced in the skill's scripts */
  endpoints: SkillEndpointUsage[];
  /** Executable script files in the package */
  scripts: string[];
  /** Other environment variables the scripts read (base URLs, model names, …) */
  settings: SkillEnvVarUsage[];
}

export interface InspectSkillState extends SkillRequirements {
  identifier: string;
  name?: string;
}
